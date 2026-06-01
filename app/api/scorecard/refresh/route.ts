import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  buildFreshScorecard,
  FRESH_KEY,
  WeekCacheEntry,
  getCronTargetWeekKeys,
  weekKey,
} from "../builder";
import { BACKUP_KEY_PREFIX, BACKUP_TTL_SECONDS } from "./backup";
import { dmAshley } from "@/app/lib/slack-dm";

// Mirror of the GET route's getAllWeekStartKeys — every Monday-ET key from
// 2026-01-05 to today. Used for the snapshot read.
function getAllWeekStartKeys(): string[] {
  const keys: string[] = [];
  // Anchor: noon ET on Monday 2026-01-05 so DST transitions never bump the
  // calendar date.
  const anchor = new Date("2026-01-05T17:00:00Z");
  const now = new Date();
  for (let weekIdx = 0; weekIdx < 520; weekIdx++) {
    const startInstant = new Date(anchor.getTime() + weekIdx * 7 * 86400000);
    const endInstant = new Date(startInstant.getTime() + 6 * 86400000);
    if (endInstant.getTime() >= now.getTime()) break;
    const etDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(startInstant);
    keys.push(etDate);
  }
  return keys;
}

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

    // GUARDRAIL 1 — Snapshot before any ?all=true rebuild.
    // Reads every existing per-week key and writes them as a single backup
    // blob (7d TTL) BEFORE the new build starts. Restore via
    // /api/scorecard/refresh/restore?backup=<timestamp>&secret=...
    let backupKey: string | null = null;
    if (allFlag) {
      try {
        const allWeekKeys = getAllWeekStartKeys();
        const kvKeys = allWeekKeys.map((k) => weekKey(k));
        const existingEntries = (await kv.mget<WeekCacheEntry[]>(...kvKeys)) || [];
        const snapshot: Record<string, WeekCacheEntry> = {};
        for (let i = 0; i < allWeekKeys.length; i++) {
          const e = existingEntries[i];
          if (e && e.data) snapshot[allWeekKeys[i]] = e;
        }
        backupKey = `${BACKUP_KEY_PREFIX}${new Date().toISOString()}`;
        await kv.set(
          backupKey,
          { snapshot, capturedAt: new Date().toISOString(), weekCount: Object.keys(snapshot).length },
          { ex: BACKUP_TTL_SECONDS }
        );
        console.log(
          `Scorecard refresh: snapshot written to ${backupKey} (${Object.keys(snapshot).length} weeks, 7d TTL)`
        );
      } catch (e) {
        console.error("Scorecard refresh: snapshot threw:", e);
        return NextResponse.json(
          {
            error: "Failed to snapshot per-week keys before ?all=true rebuild — aborting to avoid data loss",
            detail: String(e),
          },
          { status: 500 }
        );
      }
    }

    // The builder always does a full YTD fetch (GHL pagination is the bottleneck
    // — there's no cheaper way to incrementally rebuild). We then SLICE the
    // resulting weeks down to the targets and write only those per-week keys.
    const data = await buildFreshScorecard();
    const refreshedAt = new Date().toISOString();

    // GUARDRAIL 2 — Post-rebuild validation gate (?all=true only).
    // Sum new YTD settled + grossProfit, compare to the snapshot we just
    // took. If either drops >20% AND the previous value was non-trivial
    // (settled >= 5, grossProfit >= $50k), abort the write and DM Ashley.
    // Default + ?week= modes skip this check — they're scoped too narrow
    // for a YTD diff to be meaningful.
    if (allFlag) {
      const newSettled = data.weeks.reduce((s, w) => s + (w.settled || 0), 0);
      const newGrossProfit = data.weeks.reduce(
        (s, w) => s + (w.grossProfit || 0),
        0
      );

      // Read the snapshot we just wrote to compute the previous totals.
      let prevSettled = 0;
      let prevGrossProfit = 0;
      try {
        if (backupKey) {
          const blob = await kv.get<{
            snapshot: Record<string, WeekCacheEntry>;
          }>(backupKey);
          if (blob && blob.snapshot) {
            for (const week of Object.values(blob.snapshot)) {
              prevSettled += week.data?.settled || 0;
              prevGrossProfit += week.data?.grossProfit || 0;
            }
          }
        }
      } catch (e) {
        console.warn(
          "Scorecard refresh: validation gate could not read backup blob:",
          e
        );
      }

      const settledDropPct =
        prevSettled > 0 ? (prevSettled - newSettled) / prevSettled : 0;
      const profitDropPct =
        prevGrossProfit > 0
          ? (prevGrossProfit - newGrossProfit) / prevGrossProfit
          : 0;

      const SETTLED_THRESHOLD = 0.2;
      const PROFIT_THRESHOLD = 0.2;
      const PREV_SETTLED_NON_TRIVIAL = 5;
      const PREV_PROFIT_NON_TRIVIAL = 50_000;

      const settledFailed =
        prevSettled >= PREV_SETTLED_NON_TRIVIAL &&
        settledDropPct > SETTLED_THRESHOLD;
      const profitFailed =
        prevGrossProfit >= PREV_PROFIT_NON_TRIVIAL &&
        profitDropPct > PROFIT_THRESHOLD;

      if (settledFailed || profitFailed) {
        const errMsg = [
          settledFailed
            ? `settled dropped ${prevSettled}→${newSettled} (-${Math.round(
                settledDropPct * 100
              )}%)`
            : null,
          profitFailed
            ? `grossProfit dropped $${prevGrossProfit.toLocaleString()}→$${newGrossProfit.toLocaleString()} (-${Math.round(
                profitDropPct * 100
              )}%)`
            : null,
        ]
          .filter(Boolean)
          .join("; ");

        const slackText = [
          ":rotating_light: *Scorecard rebuild aborted — validation gate failed*",
          `\`?all=true\` rebuild was rejected before writing KV.`,
          `*Drift:* ${errMsg}`,
          `*Snapshot:* \`${backupKey}\` (restorable for 7 days)`,
          `*Action:* check /api/scorecard/refresh logs, then either restore the snapshot or re-run if intentional.`,
        ].join("\n");
        await dmAshley(slackText);

        console.error("Scorecard refresh: validation gate failed —", errMsg);
        return NextResponse.json(
          {
            ok: false,
            error: `Validation failed: ${errMsg}`,
            threshold: 0.2,
            backupKey,
            prev: { settled: prevSettled, grossProfit: prevGrossProfit },
            next: { settled: newSettled, grossProfit: newGrossProfit },
          },
          { status: 500 }
        );
      }
    }

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
      backupKey,
    });
  } catch (error) {
    console.error("Scorecard refresh error:", error);
    return NextResponse.json(
      { error: "Failed to build scorecard", detail: String(error) },
      { status: 500 }
    );
  }
}
