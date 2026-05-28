import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  buildFreshMarketing,
  FRESH_KEY,
  MarketingWeekCacheEntry,
  getCronTargetWeekKeys,
  weekKey,
} from "../builder";
import { BACKUP_KEY_PREFIX, BACKUP_TTL_SECONDS } from "./backup";

function getAllWeekStartKeys(): string[] {
  const keys: string[] = [];
  const current = new Date("2026-01-05T00:00:00Z");
  const now = new Date();
  while (current < now) {
    const end = new Date(current);
    end.setDate(end.getDate() + 6);
    if (end.getTime() < now.getTime()) {
      keys.push(current.toISOString().slice(0, 10));
    }
    current.setDate(current.getDate() + 7);
  }
  return keys;
}

export const dynamic = "force-dynamic";
// Bumped from 60 → 300 because the rebuilt fetchAllDeals now paginates the
// TC + Mike + Josh + Deals pipelines AND fetches per-deal detail for every
// settled-stage candidate. On full-year data that easily breaks 60s.
export const maxDuration = 300;

// GET-only refresh endpoint — same modes as scorecard/refresh:
//   1. (default)           — rebuild current + last week
//   2. ?week=YYYY-MM-DD    — rebuild ONE specified week
//   3. ?all=true           — rebuild every week from scratch
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get("secret");

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 500 }
    );
  }

  if (bearer !== secret && querySecret !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
    return NextResponse.json(
      { error: "Missing GHL env vars" },
      { status: 500 }
    );
  }

  const allFlag = searchParams.get("all") === "true";
  const oneWeek = searchParams.get("week");

  try {
    console.log(
      `Marketing refresh: mode=${
        allFlag ? "all" : oneWeek ? `week=${oneWeek}` : "cron(current+last)"
      }`
    );

    // GUARDRAIL 1 — Snapshot before any ?all=true rebuild.
    // Restore via /api/marketing/refresh/restore?backup=<timestamp>&secret=...
    let backupKey: string | null = null;
    if (allFlag) {
      try {
        const allWeekKeys = getAllWeekStartKeys();
        const kvKeys = allWeekKeys.map((k) => weekKey(k));
        const existingEntries =
          (await kv.mget<MarketingWeekCacheEntry[]>(...kvKeys)) || [];
        const snapshot: Record<string, MarketingWeekCacheEntry> = {};
        for (let i = 0; i < allWeekKeys.length; i++) {
          const e = existingEntries[i];
          if (e && e.data) snapshot[allWeekKeys[i]] = e;
        }
        backupKey = `${BACKUP_KEY_PREFIX}${new Date().toISOString()}`;
        await kv.set(
          backupKey,
          {
            snapshot,
            capturedAt: new Date().toISOString(),
            weekCount: Object.keys(snapshot).length,
          },
          { ex: BACKUP_TTL_SECONDS }
        );
        console.log(
          `Marketing refresh: snapshot written to ${backupKey} (${Object.keys(snapshot).length} weeks, 7d TTL)`
        );
      } catch (e) {
        console.error("Marketing refresh: snapshot threw:", e);
        return NextResponse.json(
          {
            error:
              "Failed to snapshot per-week keys before ?all=true rebuild — aborting to avoid data loss",
            detail: String(e),
          },
          { status: 500 }
        );
      }
    }

    const data = await buildFreshMarketing();
    const refreshedAt = new Date().toISOString();

    // Decide which weeks to PERSIST per-week.
    let targetKeys: string[];
    if (allFlag) {
      targetKeys = data.weeks.map((w) => w.weekKey);
    } else if (oneWeek) {
      targetKeys = [oneWeek];
    } else {
      targetKeys = getCronTargetWeekKeys();
    }

    const writes: { key: string; persisted: boolean }[] = [];
    for (const key of targetKeys) {
      const wk = data.weeks.find((w) => w.weekKey === key);
      if (!wk) {
        writes.push({ key, persisted: false });
        continue;
      }
      const entry: MarketingWeekCacheEntry = { data: wk, frozenAt: refreshedAt };
      await kv.set(weekKey(key), entry);
      writes.push({ key, persisted: true });
    }

    // Keep legacy aggregate key warm — same logic as scorecard/refresh.
    if (allFlag) {
      await kv.set(FRESH_KEY, { data, refreshedAt });
    } else {
      try {
        const existing = await kv.get<{ data: typeof data; refreshedAt: string }>(
          FRESH_KEY
        );
        if (existing && existing.data) {
          const updatedWeeks = existing.data.weeks.map((w) => {
            const fresh = data.weeks.find((f) => f.weekKey === w.weekKey);
            return fresh && targetKeys.includes(w.weekKey) ? fresh : w;
          });
          for (const w of data.weeks) {
            if (!updatedWeeks.find((u) => u.weekKey === w.weekKey)) {
              updatedWeeks.push(w);
            }
          }
          updatedWeeks.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
          await kv.set(FRESH_KEY, {
            data: {
              weeks: updatedWeeks,
              channels: data.channels,
              lastUpdated: refreshedAt,
            },
            refreshedAt,
          });
        } else {
          await kv.set(FRESH_KEY, { data, refreshedAt });
        }
      } catch (e) {
        console.warn("Marketing refresh: aggregate patch threw:", e);
      }
    }

    console.log("Marketing refresh: complete @", refreshedAt);

    return NextResponse.json({
      ok: true,
      refreshedAt,
      mode: allFlag ? "all" : oneWeek ? "week" : "cron",
      writes,
      backupKey,
    });
  } catch (error) {
    console.error("Marketing refresh error:", error);
    return NextResponse.json(
      { error: "Failed to build marketing", detail: String(error) },
      { status: 500 }
    );
  }
}
