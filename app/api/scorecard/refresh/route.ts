import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  buildFreshScorecard,
  FRESH_KEY,
  WeekCacheEntry,
  getCronTargetWeekKeys,
  weekKey,
} from "../builder";

export const dynamic = "force-dynamic";
// Bumped from 60 → 300 to match marketing/refresh — full YTD GHL fetch
// (calls + sellers + appts + opps + per-deal detail) routinely breaks 60s.
// Vercel Hobby caps at 300s; if we ever hit that, the next move is to
// shard by week and run incremental rebuilds (already wired below for
// the cron — full rebuild via ?all=true is the only invocation that
// scans the whole year).
export const maxDuration = 300;

// GET-only refresh endpoint. Vercel Cron only does GET, so the weekly cron
// hits this. The dashboard "Refresh now" button + manual one-week unfreeze
// also come through here.
//
// Modes (mutually exclusive):
//   1. (default — cron / Refresh button)        — rebuild current + last week
//   2. ?week=YYYY-MM-DD                          — rebuild ONE specified week
//   3. ?all=true                                 — rebuild every week from scratch
//
// Auth: Authorization: Bearer <CRON_SECRET> OR ?secret=<CRON_SECRET>.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get("secret");

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

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
      `Scorecard refresh: mode=${
        allFlag ? "all" : oneWeek ? `week=${oneWeek}` : "cron(current+last)"
      }`
    );

    // The builder always does a full YTD fetch (GHL pagination is the bottleneck
    // — there's no cheaper way to incrementally rebuild). We then SLICE the
    // resulting weeks down to the targets and write only those per-week keys.
    const data = await buildFreshScorecard();
    const refreshedAt = new Date().toISOString();

    // Decide which weeks to PERSIST.
    let targetKeys: string[];
    if (allFlag) {
      targetKeys = data.weeks.map((w) => w.startDate);
    } else if (oneWeek) {
      targetKeys = [oneWeek];
    } else {
      targetKeys = getCronTargetWeekKeys();
    }

    const writes: { key: string; persisted: boolean }[] = [];
    for (const key of targetKeys) {
      const wk = data.weeks.find((w) => w.startDate === key);
      if (!wk) {
        writes.push({ key, persisted: false });
        continue;
      }
      const entry: WeekCacheEntry = { data: wk, frozenAt: refreshedAt };
      await kv.set(weekKey(key), entry);
      writes.push({ key, persisted: true });
    }

    // Keep the legacy aggregate key warm too — `?all=true` writes the full
    // YTD payload; cron / single-week writes update only the relevant slice.
    if (allFlag) {
      await kv.set(FRESH_KEY, { data, refreshedAt });
    } else {
      // Patch the aggregate so /api/scorecard readers using the old shape
      // still see fresh numbers for the rebuilt weeks. (Per-week assembly
      // in the GET route is the real source of truth, but keeping the
      // aggregate consistent avoids a mid-deploy split read.)
      try {
        const existing = await kv.get<{ data: typeof data; refreshedAt: string }>(
          FRESH_KEY
        );
        if (existing && existing.data) {
          const updatedWeeks = existing.data.weeks.map((w) => {
            const fresh = data.weeks.find((f) => f.startDate === w.startDate);
            return fresh && targetKeys.includes(w.startDate) ? fresh : w;
          });
          // Insert any genuinely new weeks (e.g. first run of the new current week)
          for (const w of data.weeks) {
            if (!updatedWeeks.find((u) => u.startDate === w.startDate)) {
              updatedWeeks.push(w);
            }
          }
          updatedWeeks.sort((a, b) => a.startDate.localeCompare(b.startDate));
          await kv.set(FRESH_KEY, {
            data: {
              weeks: updatedWeeks,
              lastUpdated: refreshedAt,
            },
            refreshedAt,
          });
        } else {
          // Cold KV: seed it with the full YTD payload we just computed.
          await kv.set(FRESH_KEY, { data, refreshedAt });
        }
      } catch (e) {
        console.warn("Scorecard refresh: aggregate patch threw:", e);
      }
    }

    console.log("Scorecard refresh: complete @", refreshedAt);
    return NextResponse.json({
      ok: true,
      refreshedAt,
      mode: allFlag ? "all" : oneWeek ? "week" : "cron",
      writes,
    });
  } catch (error) {
    console.error("Scorecard refresh error:", error);
    return NextResponse.json(
      { error: "Failed to build scorecard", detail: String(error) },
      { status: 500 }
    );
  }
}
