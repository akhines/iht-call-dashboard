import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BASE = "https://services.leadconnectorhq.com";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
  };
}

function getChannel(source: string, campaign: string): string {
  const matchOne = (raw: string): string | null => {
    const s = (raw || "").toLowerCase().trim();
    if (!s) return null;
    if (s.includes("ppc") || s.includes("google ads")) return "PPC";
    if (s.includes("seo") || s.includes("google search") || s.includes("organic") || s.includes("gmb")) return "SEO";
    if (s.includes("direct mail") || s.includes("probate")) return "Mail";
    if (s.startsWith("tv") || /\btv\b/.test(s)) return "TV";
    if (s.includes("ppl") || s.includes("pay per lead")) return "PPL";
    if (s.includes("referral")) return "Other";
    if (s.includes("mail")) return "Mail";
    return null;
  };
  return matchOne(source) || matchOne(campaign) || "Other";
}

const DEAL_IDS = [
  ["Dorothy*TV", "0vFLywBqLaFb6IO7P7Bg"],
  ["Jerry Branch*TV", "0cGydAyTkA9FapPtL4E4"],
  ["George Jackson*TV", "0VqRZjp8sjpz7ZAJkxvJ"],
  ["Mrs.Carter*TV", "J4A0XUxdQKR23WrvZoEt"],
  ["Ronald Jamison*TV", "SKkTjzDkRj7ceSgrbF1G"],
];

export async function GET() {
  const out: Array<Record<string, unknown>> = [];
  for (const [name, id] of DEAL_IDS) {
    try {
      const r = await fetch(`${BASE}/opportunities/${id}`, { headers: getHeaders() });
      const detail = r.ok ? await r.json() : null;
      const opp = detail?.opportunity || detail || {};
      const channelFromSource = getChannel(opp.source || "", "");
      out.push({
        name,
        id,
        source: opp.source ?? null,
        channelFromSource,
        contactId: opp.contactId ?? null,
        lastStageChangeAt: opp.lastStageChangeAt ?? null,
      });
    } catch (e) {
      out.push({ name, id, error: String(e) });
    }
  }
  return NextResponse.json(out);
}
