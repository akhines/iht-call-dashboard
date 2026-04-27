import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  FRESH_KEY,
  MANUAL_INPUTS_KEY,
  MarketingCachePayload,
  MarketingWeekCacheEntry,
  applyManualInputs,
  weekKey,
} from "./builder";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Match getWeeks2026 in the builder — every Monday-week from 2026-01-05 → today.
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
// Per-week historical lock: reads `marketing_week_v1_{monday}` for every
// week of 2026 via `kv.mget`. Manual inputs (spend, mailers) are still
// overlaid live on every read so user edits show up immediately without
// waiting for the next cron.
export async function GET() {
  const allKeys = getAllWeekStartKeys();
  const kvKeys = allKeys.map((k) => weekKey(k));

  let entries: (MarketingWeekCacheEntry | null)[] = [];
  try {
    entries = (await kv.mget<MarketingWeekCacheEntry[]>(...kvKeys)) || [];
  } catch (error) {
    console.error("Marketing GET per-week mget failed:", error);
    return NextResponse.json(
      {
        error:
          "Marketing cache temporarily unavailable. Try again shortly or click Refresh.",
        refreshedAt: null,
      },
      { status: 503 }
    );
  }

  // Live-overlay manual inputs (spend, mailers) regardless of source path.
  let manualInputs: Record<
    string,
    Record<string, { spend?: number; mailersSent?: number }>
  > = {};
  try {
    const saved = await kv.get<typeof manualInputs>(MANUAL_INPUTS_KEY);
    if (saved) manualInputs = saved;
  } catch {
    // KV miss on inputs is fine — just no overlay
  }

  // If per-week store is completely cold, fall back to legacy aggregate so the
  // dashboard isn't empty between deploy and the first ?all=true populate run.
  const haveAnyPerWeek = entries.some((e) => e && e.data);
  if (!haveAnyPerWeek) {
    try {
      const cached = await kv.get<MarketingCachePayload>(FRESH_KEY);
      if (cached && cached.data) {
        const overlaid = applyManualInputs(cached.data.weeks, manualInputs);
        return NextResponse.json({
          weeks: overlaid,
          channels: cached.data.channels,
          lastUpdated: cached.data.lastUpdated,
          refreshedAt: cached.refreshedAt,
          source: "legacy_aggregate",
        });
      }
    } catch (e) {
      console.error("Marketing GET legacy aggregate read failed:", e);
    }
    return NextResponse.json(
      {
        error:
          "Marketing cache empty, refreshing on schedule. Try again in a few minutes or click Refresh.",
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

  // Channel list: pull from any populated week (every entry has the same set).
  const channels = weeks[0] ? Object.keys(weeks[0].channels) : [];

  const overlaid = applyManualInputs(weeks, manualInputs);

  return NextResponse.json({
    weeks: overlaid,
    channels,
    lastUpdated: latestFrozen,
    refreshedAt: latestFrozen,
    missingWeeks: missingWeeks.length > 0 ? missingWeeks : undefined,
  });
}

// POST: save manual inputs (spend, mailers). Always allowed — these are
// user-typed values, not GHL data. They get overlaid on every GET.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { weekKey: weekKeyArg, channel, spend, mailersSent } = body;

    let manualInputs: Record<
      string,
      Record<string, { spend?: number; mailersSent?: number }>
    > = {};
    try {
      const saved = await kv.get<typeof manualInputs>(MANUAL_INPUTS_KEY);
      if (saved) manualInputs = saved;
    } catch {
      // KV miss
    }

    if (!manualInputs[weekKeyArg]) manualInputs[weekKeyArg] = {};
    manualInputs[weekKeyArg][channel] = {
      spend: spend ?? manualInputs[weekKeyArg][channel]?.spend ?? 0,
      mailersSent:
        mailersSent ?? manualInputs[weekKeyArg][channel]?.mailersSent ?? 0,
    };

    await kv.set(MANUAL_INPUTS_KEY, manualInputs);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Marketing POST save error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
