import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  buildFreshScorecard,
  FRESH_KEY,
} from "../builder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET-only refresh endpoint. Vercel Cron only does GET, so this is what the
// weekly cron hits. It is also the endpoint the dashboard's "Refresh now"
// button calls (with ?secret=$CRON_SECRET).
//
// Auth: either
//   - Authorization: Bearer <CRON_SECRET> header (Vercel Cron sends this if
//     CRON_SECRET is set as a Vercel project env var)
//   - ?secret=<CRON_SECRET> query string (manual refresh button)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get("secret");

  // Vercel Cron auto-injects: Authorization: Bearer <CRON_SECRET> when
  // CRON_SECRET env var exists. Accept either form.
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

  try {
    console.log("Scorecard refresh: building fresh data...");
    const data = await buildFreshScorecard();
    const refreshedAt = new Date().toISOString();
    await kv.set(FRESH_KEY, { data, refreshedAt });
    console.log("Scorecard refresh: complete @", refreshedAt);

    return NextResponse.json({
      ok: true,
      refreshedAt,
      weeks: data.weeks.length,
    });
  } catch (error) {
    console.error("Scorecard refresh error:", error);
    return NextResponse.json(
      { error: "Failed to build scorecard", detail: String(error) },
      { status: 500 }
    );
  }
}
