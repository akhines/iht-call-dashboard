import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { buildFreshScorecard, FRESH_KEY, ScorecardCachePayload } from "./builder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: thin KV reader — never hits GHL.
// On cold miss / KV unavailable, returns 503 with friendly message. The
// weekly cron + manual refresh button are the only writers.
export async function GET() {
  let cached: ScorecardCachePayload | null = null;
  try {
    cached = await kv.get<ScorecardCachePayload>(FRESH_KEY);
  } catch (error) {
    console.error("Scorecard GET KV read failed:", error);
    return NextResponse.json(
      {
        error:
          "Scorecard cache temporarily unavailable. Try again shortly or click Refresh.",
        refreshedAt: null,
      },
      { status: 503 }
    );
  }

  if (cached && cached.data) {
    return NextResponse.json({
      ...cached.data,
      refreshedAt: cached.refreshedAt,
    });
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
