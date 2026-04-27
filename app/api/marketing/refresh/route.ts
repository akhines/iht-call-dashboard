import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { buildFreshMarketing, FRESH_KEY } from "../builder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET-only refresh endpoint. Vercel Cron only does GET, so the weekly cron
// hits this. The dashboard "Refresh now" button also calls this with
// ?secret=$CRON_SECRET.
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

  try {
    console.log("Marketing refresh: building fresh data...");
    const data = await buildFreshMarketing();
    const refreshedAt = new Date().toISOString();
    await kv.set(FRESH_KEY, { data, refreshedAt });
    console.log("Marketing refresh: complete @", refreshedAt);

    return NextResponse.json({
      ok: true,
      refreshedAt,
      weeks: data.weeks.length,
    });
  } catch (error) {
    console.error("Marketing refresh error:", error);
    return NextResponse.json(
      { error: "Failed to build marketing", detail: String(error) },
      { status: 500 }
    );
  }
}
