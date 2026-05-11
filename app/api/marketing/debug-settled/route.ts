import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://services.leadconnectorhq.com";
const MARKETING_CAMPAIGN_FIELD = "4fOhwf1m5nhK1c9vI6SJ";

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
  return matchOne(campaign) || matchOne(source) || "Other";
}

export async function GET() {
  const LOC = process.env.GHL_LOCATION_ID;
  const out: Array<Record<string, unknown>> = [];

  // 1. Search closed deals
  const url = `${BASE}/opportunities/search?location_id=${LOC}&pipeline_id=DiGXnGTlQCOMZQJmWQe9&pipeline_stage_id=245bc5b3-e2ac-4886-8928-907560ec3f15&limit=100`;
  const r = await fetch(url, { headers: getHeaders() });
  const search = await r.json();

  for (const o of (search.opportunities || []).slice(0, 50)) {
    const t = new Date(o.lastStageChangeAt || 0).getTime();
    if (t < new Date("2026-04-01").getTime()) continue;
    if (!o.monetaryValue) continue;

    // Step 1: search row source
    const searchSource = o.source || "";

    // Step 2: per-deal detail fetch
    let detailSource = "";
    let detailContactId = "";
    try {
      const dr = await fetch(`${BASE}/opportunities/${o.id}`, { headers: getHeaders() });
      if (dr.ok) {
        const detail = await dr.json();
        const opp = detail?.opportunity || detail;
        detailSource = opp?.source || "";
        detailContactId = opp?.contactId || "";
      }
    } catch {}

    // Step 3: merged source (what the builder uses)
    const mergedSource = detailSource || searchSource;

    // Step 4: contact MC (via direct fetch)
    let contactMC = "";
    let contactSrc = "";
    if (detailContactId || o.contactId) {
      try {
        const cr = await fetch(`${BASE}/contacts/${detailContactId || o.contactId}`, { headers: getHeaders() });
        if (cr.ok) {
          const cd = await cr.json();
          const c = cd.contact || {};
          contactSrc = c.source || "";
          const cfs: Record<string, string> = {};
          for (const cf of c.customFields || []) cfs[cf.id] = cf.value;
          contactMC = cfs[MARKETING_CAMPAIGN_FIELD] || "";
        }
      } catch {}
    }

    out.push({
      name: o.name,
      monetaryValue: o.monetaryValue,
      lastStageChangeAt: (o.lastStageChangeAt || "").slice(0, 10),
      searchSource,
      detailSource,
      mergedSource,
      contactSrc,
      contactMC,
      channel_from_mergedSource: getChannel(mergedSource, ""),
      channel_from_contactMC: getChannel("", contactMC),
      channel_from_both: getChannel(contactSrc || mergedSource, contactMC),
    });
  }

  return NextResponse.json(out);
}
