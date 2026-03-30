import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

const BASE = "https://services.leadconnectorhq.com";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
}

const LOCATION_ID = () => process.env.GHL_LOCATION_ID!;

const MIKE_CALENDAR = "1pRjeG5QkespBBQK3u1s";
const JOSH_CALENDAR = "19xfzyb7vedvmzqNf8FK";
const TC_PIPELINE = "ofMQolXiKGyg6WNOJS88";
const MIKE_PIPELINE = "nwSjS0rUTMGbgDvyrEe4";
const JOSH_PIPELINE = "ggnBpwig6OE37fXPQv7a";
const CONTACT_TYPE_FIELD = "IfkLFRqVzW9XrCkXvPUQ";
const MARKETING_CAMPAIGN_FIELD = "4fOhwf1m5nhK1c9vI6SJ";

const OPP_FIELDS = {
  abPrice: "auq20sgMLdGuBqt5f94I",
  bcPrice: "eYnQy81LxuYK5Wxwjv5W",
  grossProfit: "xCCFXqTAVdFowPoJWEz6",
};

const JAN1_2026 = new Date("2026-01-01T00:00:00Z").getTime();

// Channel mapping from GHL source/campaign values
function getChannel(source: string, campaign: string): string {
  const s = (source + " " + campaign).toLowerCase();
  if (s.includes("tv")) return "TV";
  if (s.includes("ppc") || s.includes("google ads")) return "PPC";
  if (s.includes("direct mail") || s.includes("mail")) return "Mail";
  if (s.includes("seo") || s.includes("google search") || s.includes("organic")) return "SEO";
  if (s.includes("ppl") || s.includes("pay per lead")) return "PPL";
  if (s.includes("gmb") || s.includes("google my business")) return "SEO";
  if (s.includes("referral")) return "Other";
  if (s.includes("probate")) return "Mail";
  return "Other";
}

interface Week { start: Date; end: Date; key: string; }

function getWeeks2026(): Week[] {
  const weeks: Week[] = [];
  const current = new Date("2026-01-05T00:00:00Z");
  const now = new Date();
  while (current < now) {
    const end = new Date(current);
    end.setDate(end.getDate() + 6);
    weeks.push({ start: new Date(current), end: new Date(Math.min(end.getTime(), now.getTime())), key: current.toISOString().slice(0, 10) });
    current.setDate(current.getDate() + 7);
  }
  return weeks;
}

function findWeekKey(date: Date, weeks: Week[]): string | null {
  const t = date.getTime();
  for (const w of weeks) {
    if (t >= w.start.getTime() && t <= w.end.getTime() + 86400000) return w.key;
  }
  return null;
}

// ========== FETCH ALL DATA ==========

interface LeadRecord { date: number; channel: string; hasAddress: boolean; }
interface ApptRecord { date: number; channel: string; cancelled: boolean; completed: boolean; }
interface DealRecord { date: number; channel: string; category: string; abPrice: number; bcPrice: number; grossProfit: number; }

async function fetchAllSellerLeads(): Promise<LeadRecord[]> {
  const leads: LeadRecord[] = [];
  let startAfterId = "";
  let startAfter = 0;

  for (let page = 0; page < 50; page++) {
    let url = `${BASE}/contacts/?locationId=${LOCATION_ID()}&limit=100`;
    if (startAfterId) url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    const contacts = data.contacts || [];
    if (contacts.length === 0) break;

    for (const c of contacts) {
      const created = new Date(c.dateAdded).getTime();
      if (created < JAN1_2026) continue;

      const cfs: Record<string, string> = {};
      for (const cf of c.customFields || []) cfs[cf.id] = cf.value;

      if (cfs[CONTACT_TYPE_FIELD] === "Seller") {
        const campaign = cfs[MARKETING_CAMPAIGN_FIELD] || "";
        leads.push({
          date: created,
          channel: getChannel(c.source || "", campaign),
          hasAddress: !!(c.address1 && c.address1.trim()),
        });
      }
    }

    const meta = data.meta || {};
    if (!meta.nextPageUrl) break;
    startAfterId = meta.startAfterId || "";
    startAfter = meta.startAfter || 0;
    const lastCreated = new Date(contacts[contacts.length - 1].dateAdded).getTime();
    if (lastCreated < JAN1_2026) break;
  }
  return leads;
}

async function fetchAllAppts(): Promise<ApptRecord[]> {
  const appts: ApptRecord[] = [];
  const now = Date.now();

  for (const calId of [MIKE_CALENDAR, JOSH_CALENDAR]) {
    const url = `${BASE}/calendars/events?locationId=${LOCATION_ID()}&calendarId=${calId}&startTime=${JAN1_2026}&endTime=${now}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) continue;
    const data = await res.json();

    for (const e of data.events || []) {
      if (e.deleted) continue;
      const title = (e.title || "");
      const titleLower = title.toLowerCase();
      const status = e.appointmentStatus || "";
      const cancelled = status === "cancelled" || titleLower.startsWith("c-") || titleLower.includes("cancel");
      const endTime = new Date(e.endTime).getTime();

      let channel = "Other";
      if (titleLower.includes("*tv") || titleLower.includes("tv ")) channel = "TV";
      else if (titleLower.includes("*dm") || titleLower.includes("mail")) channel = "Mail";
      else if (titleLower.includes("ppc") || titleLower.includes("google")) channel = "PPC";
      else if (titleLower.includes("seo")) channel = "SEO";

      appts.push({
        date: new Date(e.startTime).getTime(),
        channel,
        cancelled,
        completed: !cancelled && endTime < now,
      });
    }
  }
  return appts;
}

async function fetchAllDeals(): Promise<DealRecord[]> {
  const deals: DealRecord[] = [];

  // A-B signed = TC pipeline createdAt
  const tcRes = await fetch(`${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${TC_PIPELINE}&limit=100`, { headers: getHeaders() });
  if (tcRes.ok) {
    const tcData = await tcRes.json();
    for (const o of tcData.opportunities || []) {
      const d = new Date(o.createdAt).getTime();
      if (d < JAN1_2026) continue;
      const channel = getChannel(o.source || "", "");

      // Fetch detail for pricing
      let abPrice = 0, bcPrice = 0, grossProfit = 0;
      const detailRes = await fetch(`${BASE}/opportunities/${o.id}`, { headers: getHeaders() });
      if (detailRes.ok) {
        const detail = await detailRes.json();
        const opp = detail.opportunity || detail;
        for (const cf of opp.customFields || []) {
          const val = parseFloat(cf.fieldValue || cf.fieldValueString || "0") || 0;
          if (cf.id === OPP_FIELDS.abPrice) abPrice = val;
          if (cf.id === OPP_FIELDS.bcPrice) bcPrice = val;
          if (cf.id === OPP_FIELDS.grossProfit) grossProfit = val;
        }
      }

      deals.push({ date: d, channel, category: "ab", abPrice, bcPrice, grossProfit });
    }
  }

  // Closings from Mike/Josh closer pipelines
  const closerStages = [
    { pipeline: MIKE_PIPELINE, stage: "64d1fa71-6952-41cd-be5e-1536715b6d87" }, // Mike 1 YD LINE
    { pipeline: JOSH_PIPELINE, stage: "0c4afc64-8163-4723-9f78-d4a0d7e1d037" }, // Josh WON!
  ];
  for (const q of closerStages) {
    const res = await fetch(`${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${q.pipeline}&pipeline_stage_id=${q.stage}&limit=100`, { headers: getHeaders() });
    if (!res.ok) continue;
    const data = await res.json();
    for (const o of data.opportunities || []) {
      const d = new Date(o.lastStageChangeAt).getTime();
      if (d < JAN1_2026) continue;
      deals.push({ date: d, channel: getChannel(o.source || "", ""), category: "closing", abPrice: 0, bcPrice: 0, grossProfit: 0 });
    }
  }

  // Settled = TC Closed Dispo
  const settledRes = await fetch(`${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${TC_PIPELINE}&pipeline_stage_id=8464b838-cb2d-497a-89f6-07c4025ae17f&limit=100`, { headers: getHeaders() });
  if (settledRes.ok) {
    const data = await settledRes.json();
    for (const o of data.opportunities || []) {
      const d = new Date(o.lastStageChangeAt).getTime();
      if (d < JAN1_2026) continue;
      // Find matching A-B deal for pricing
      const abDeal = deals.find((deal) => deal.category === "ab" && o.name && deal.channel === getChannel(o.source || "", ""));
      deals.push({
        date: d,
        channel: getChannel(o.source || "", ""),
        category: "settled",
        abPrice: abDeal?.abPrice || 0,
        bcPrice: abDeal?.bcPrice || 0,
        grossProfit: abDeal?.grossProfit || 0,
      });
    }
  }

  return deals;
}

// ========== CHANNEL DATA ==========

const CHANNELS = ["TV", "PPC", "Mail", "PPL", "Other", "SEO"] as const;

interface ChannelWeekData {
  leads: number;
  appts: number;
  ab: number;
  closings: number;
  settled: number;
  grossProfit: number;
  spend: number;
  mailersSent: number;
}

export interface MarketingWeekData {
  weekKey: string;
  startDate: string;
  endDate: string;
  channels: Record<string, ChannelWeekData>;
}

export async function GET() {
  try {
    if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
      return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
    }

    const weeks = getWeeks2026();

    console.log("Marketing: fetching all GHL data...");
    const [allLeads, allAppts, allDeals] = await Promise.all([
      fetchAllSellerLeads(),
      fetchAllAppts(),
      fetchAllDeals(),
    ]);
    console.log(`Marketing: ${allLeads.length} leads, ${allAppts.length} appts, ${allDeals.length} deals`);

    // Load manual inputs from KV
    let manualInputs: Record<string, Record<string, { spend?: number; mailersSent?: number }>> = {};
    try {
      const saved = await kv.get<typeof manualInputs>("marketing_inputs");
      if (saved) manualInputs = saved;
    } catch {
      // KV not configured yet, that's OK
    }

    const weekData: MarketingWeekData[] = weeks.map((w) => {
      const channels: Record<string, ChannelWeekData> = {};
      for (const ch of CHANNELS) {
        const weekLeads = allLeads.filter((l) => l.channel === ch && findWeekKey(new Date(l.date), weeks) === w.key);
        const weekAppts = allAppts.filter((a) => a.channel === ch && !a.cancelled && a.completed && findWeekKey(new Date(a.date), weeks) === w.key);
        const weekAb = allDeals.filter((d) => d.channel === ch && d.category === "ab" && findWeekKey(new Date(d.date), weeks) === w.key);
        const weekClosings = allDeals.filter((d) => d.channel === ch && d.category === "closing" && findWeekKey(new Date(d.date), weeks) === w.key);
        const weekSettled = allDeals.filter((d) => d.channel === ch && d.category === "settled" && findWeekKey(new Date(d.date), weeks) === w.key);

        const manual = manualInputs[w.key]?.[ch] || {};

        channels[ch] = {
          leads: weekLeads.length,
          appts: weekAppts.length,
          ab: weekAb.length,
          closings: weekClosings.length,
          settled: weekSettled.length,
          grossProfit: weekSettled.reduce((a, d) => a + (d.grossProfit || (d.bcPrice - d.abPrice)), 0),
          spend: manual.spend || 0,
          mailersSent: manual.mailersSent || 0,
        };
      }

      return {
        weekKey: w.key,
        startDate: w.start.toISOString().slice(0, 10),
        endDate: w.end.toISOString().slice(0, 10),
        channels,
      };
    });

    return NextResponse.json({
      weeks: weekData,
      channels: CHANNELS,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Marketing API error:", error);
    return NextResponse.json({ error: "Failed to build marketing scorecard" }, { status: 500 });
  }
}

// Save manual inputs (spend, mailers)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { weekKey, channel, spend, mailersSent } = body;

    let manualInputs: Record<string, Record<string, { spend?: number; mailersSent?: number }>> = {};
    try {
      const saved = await kv.get<typeof manualInputs>("marketing_inputs");
      if (saved) manualInputs = saved;
    } catch {
      // KV not configured yet
    }

    if (!manualInputs[weekKey]) manualInputs[weekKey] = {};
    manualInputs[weekKey][channel] = {
      spend: spend ?? manualInputs[weekKey][channel]?.spend ?? 0,
      mailersSent: mailersSent ?? manualInputs[weekKey][channel]?.mailersSent ?? 0,
    };

    await kv.set("marketing_inputs", manualInputs);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Save error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
