import { NextResponse } from "next/server";
import { fetchAllOpportunities2026 } from "../builder";

export const runtime = "nodejs";
export const maxDuration = 300;

// Debug: return per-deal ab_signed/bc_signed attribution. Used to validate
// closer attribution against Ashley's manual count.
export async function GET() {
  const opps = await fetchAllOpportunities2026();
  const ab = opps.filter((o) => o.category === "ab_signed");
  const bc = opps.filter((o) => o.category === "bc_signed");
  const summary = (rows: typeof ab) => ({
    total: rows.length,
    Mike: rows.filter((r) => r.closer === "Mike").length,
    Josh: rows.filter((r) => r.closer === "Josh").length,
    rows: rows
      .map((r) => ({
        date: new Date(r.date).toISOString().slice(0, 10),
        closer: r.closer,
        name: r.name,
        source: r.source,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  });
  return NextResponse.json({
    abSigned: summary(ab),
    bcSigned: summary(bc),
  });
}
