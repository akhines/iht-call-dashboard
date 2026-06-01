import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  buildFreshScorecard,
  FRESH_KEY,
  ScorecardCachePayload,
  WeekCacheEntry,
  weekKey,
} from "./builder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Compute every Monday-week key from 2026-01-05 → today, matching
// getWeeks2026 in the builder. Used by GET to know which per-week KV keys
// to mget. Keys are ET-local YYYY-MM-DD strings aligned to ET Mondays.
function getAllWeekStartKeys(): string[] {
  const keys: string[] = [];
  // Anchor: Monday 2026-01-05 ET. Use a noon-ET timestamp so daylight-saving
  // transitions can't bump us to a different calendar date.
  const anchor = new Date("2026-01-05T17:00:00Z"); // 12:00 noon ET (EST)
  const now = new Date();
  for (let weekIdx = 0; weekIdx < 520; weekIdx++) {
    const startInstant = new Date(anchor.getTime() + weekIdx * 7 * 86400000);
    const endInstant = new Date(startInstant.getTime() + 6 * 86400000);
    if (endInstant.getTime() >= now.getTime()) break;
    // ET date key from the noon-ET start instant.
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

// GET: thin KV reader — never hits GHL.
// Per-week historical lock: reads `scorecard_week_v1_{monday}` for every
// week of 2026 so far via `kv.mget`, then assembles them. If any week is
// missing from the per-week store, we DO NOT fall back to live GHL — we
// return that week as null in the payload + add a `missingWeeks` note.
export async function GET() {
  const allKeys = getAllWeekStartKeys();
  const kvKeys = allKeys.map((k) => weekKey(k));

  let entries: (WeekCacheEntry | null)[] = [];
  try {
    entries = (await kv.mget<WeekCacheEntry[]>(...kvKeys)) || [];
  } catch (error) {
    console.error("Scorecard GET per-week mget failed:", error);
    return NextResponse.json(
      {
        error:
          "Scorecard cache temporarily unavailable. Try again shortly or click Refresh.",
        refreshedAt: null,
      },
      { status: 503 }
    );
  }

  // If the per-week store is completely cold, fall back to legacy aggregate
  // so the dashboard isn't empty between deploy and the first ?all=true run.
  const haveAnyPerWeek = entries.some((e) => e && e.data);
  if (!haveAnyPerWeek) {
    try {
      const cached = await kv.get<ScorecardCachePayload>(FRESH_KEY);
      if (cached && cached.data) {
        return NextResponse.json({
          ...cached.data,
          refreshedAt: cached.refreshedAt,
          source: "legacy_aggregate",
        });
      }
    } catch (e) {
      console.error("Scorecard GET legacy aggregate read failed:", e);
    }
    return NextResponse.json(
      {
        error:
          "Scorecard cache empty, refreshing on schedule. Try again in a few minutes or click Refresh.",
        refreshedAt: null,
      },
      { status: 503 }
    );
  }

  const weeks = [];
  const missingWeeks: string[] = [];
  let latestFrozen = "";
  for (let i = 0; i < allKeys.length; i++) {
    const k = allKeys[i];
    const entry = entries[i];
    if (!entry || !entry.data) {
      missingWeeks.push(k);
      continue;
    }
    weeks.push(entry.data);
    if (entry.frozenAt > latestFrozen) latestFrozen = entry.frozenAt;
  }

  return NextResponse.json({
    weeks,
    lastUpdated: latestFrozen,
    refreshedAt: latestFrozen,
    missingWeeks: missingWeeks.length > 0 ? missingWeeks : undefined,
  });
}

// POST: heavy refresh — protected by CRON_SECRET header.
// Alternative to the GET /api/scorecard/refresh endpoint (which Vercel Cron
// uses since Vercel Cron is GET-only). Useful for programmatic triggers.
export async function POST(request: Request) {
  const auth = request.headers.get("x-cron-secret");
  if (auth !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  try {
    if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
      return NextResponse.json(
        { error: "Missing env vars" },
        { status: 500 }
      );
    }

    console.log("Scorecard: POST refresh triggered, building fresh data...");
    const data = await buildFreshScorecard();
    const refreshedAt = new Date().toISOString();
    await kv.set(FRESH_KEY, { data, refreshedAt });
    console.log("Scorecard: POST refresh complete @", refreshedAt);

    return NextResponse.json({ ok: true, refreshedAt });
  } catch (error) {
    console.error("Scorecard POST refresh error:", error);
    return NextResponse.json(
      { error: "Failed to build scorecard" },
      { status: 500 }
    );
  }
}
