import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  FRESH_KEY,
  MANUAL_INPUTS_KEY,
  MarketingCachePayload,
  applyManualInputs,
} from "./builder";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET: thin KV reader — never hits GHL.
// Manual inputs (spend, mailers) are still overlaid live so the user sees
// their edits immediately without waiting for the next weekly refresh.
export async function GET() {
  try {
    const cached = await kv.get<MarketingCachePayload>(FRESH_KEY);
    if (!cached || !cached.data) {
      return NextResponse.json(
        {
          error:
            "Marketing cache empty, refreshing on schedule. Try again in a few minutes or click Refresh.",
          refreshedAt: null,
        },
        { status: 503 }
      );
    }

    // Live-overlay manual inputs (spend, mailers)
    let manualInputs: Record<
      string,
      Record<string, { spend?: number; mailersSent?: number }>
    > = {};
    try {
      const saved = await kv.get<typeof manualInputs>(MANUAL_INPUTS_KEY);
      if (saved) manualInputs = saved;
    } catch {
      // KV miss is fine
    }

    const overlaid = applyManualInputs(cached.data.weeks, manualInputs);

    return NextResponse.json({
      weeks: overlaid,
      channels: cached.data.channels,
      lastUpdated: cached.data.lastUpdated,
      refreshedAt: cached.refreshedAt,
    });
  } catch (error) {
    console.error("Marketing GET KV read error:", error);
    return NextResponse.json(
      { error: "Failed to read marketing cache", refreshedAt: null },
      { status: 500 }
    );
  }
}

// POST: save manual inputs (spend, mailers). Always allowed — these are
// user-typed values, not GHL data. They get overlaid on every GET.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { weekKey, channel, spend, mailersSent } = body;

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

    if (!manualInputs[weekKey]) manualInputs[weekKey] = {};
    manualInputs[weekKey][channel] = {
      spend: spend ?? manualInputs[weekKey][channel]?.spend ?? 0,
      mailersSent:
        mailersSent ?? manualInputs[weekKey][channel]?.mailersSent ?? 0,
    };

    await kv.set(MANUAL_INPUTS_KEY, manualInputs);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Marketing POST save error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

