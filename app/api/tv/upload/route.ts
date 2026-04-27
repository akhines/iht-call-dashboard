import { NextResponse } from "next/server";

// Server-side proxy for TV invoice PDF uploads. The browser POSTs the file
// here without an API key; this route forwards to bcdi-api with the
// BCDI_API_KEY held server-side. Keeps the secret out of the browser.
export const runtime = "nodejs";
export const maxDuration = 60;

const BCDI_API = "https://bcdi-api.fly.dev";

export async function POST(req: Request) {
  const apiKey = process.env.BCDI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "BCDI_API_KEY not configured on iht-call-dashboard. Set via `vercel env add BCDI_API_KEY production`." },
      { status: 500 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append("file", file as Blob);
  // pass kind through if browser sent one
  const kind = formData.get("kind");
  if (kind) upstream.append("kind", kind as string);

  const r = await fetch(`${BCDI_API}/api/tv/ingest-invoice`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: upstream,
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
