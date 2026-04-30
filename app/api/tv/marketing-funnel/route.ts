import { NextResponse } from "next/server";

// Server-side proxy for the TV marketing-funnel rollup. The browser fetches
// `/api/tv/marketing-funnel` (same origin), this route forwards to bcdi-api.
// Eliminates CORS variability and matches the /api/tv/upload pattern.
export const runtime = "nodejs";
export const maxDuration = 60;

const BCDI_API = "https://bcdi-api.fly.dev";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1" ? "?refresh=1" : "";
  const r = await fetch(`${BCDI_API}/api/tv/marketing-funnel${refresh}`, {
    cache: "no-store",
  });
  const text = await r.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return NextResponse.json(body, { status: r.status });
}
