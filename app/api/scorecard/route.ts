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

// Compute every Monday-week key from 2026-01-05 → today, matching getWeeks2026
// in the builder. Used by GET to know which per-week KV keys to mget.
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
