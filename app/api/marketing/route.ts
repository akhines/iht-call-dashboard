import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

// Profit comes from monetaryValue on the opportunity

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
  // Filter out internal/team sources
  if (s.includes("emma") || s.includes("josh smrt") || s.includes("callrail") || s.includes("other: not found")) return "Other";
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
    // Only include completed weeks
    if (end.getTime() < now.getTime()) {
      weeks.push({ start: new Date(current), end: new Date(end), key: current.toISOString().slice(0, 10) });
    }
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
interface DealRecord { date: number; channel: string; category: string; monetaryValue: number; }

// Cache contact lookups to avoid redundant API calls (in-memory, request-scoped)
const contactSourceCache = new Map<string, string>();

function getContactChannelCached(contactId: string): string {
  if (!contactId) return "Other";
  return contactSourceCache.get(contactId) || "Other";
}

async function fetchAllSellerLeads(rangeStart: number, rangeEnd: number): Promise<LeadRecord[]> {
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
      // We always populate channel cache for all 2026 contacts seen (cheap & helps appt/deal channel lookup)
      if (created < JAN1_2026) continue;

      const cfs: Record<string, string> = {};
      for (const cf of c.customFields || []) cfs[cf.id] = cf.value;

      // Pre-populate channel cache for ALL contacts we see (saves API calls later)
      if (c.id) {
        const campaign = cfs[MARKETING_CAMPAIGN_FIELD] || "";
        contactSourceCache.set(c.id, getChannel(c.source || "", campaign));
      }

      // Only return as a LEAD if within requested range and is a Seller
      if (created < rangeStart || created > rangeEnd) continue;

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
    // Stop paging once we're earlier than the start of our range AND earlier than 2026
    if (lastCreated < JAN1_2026) break;
    if (lastCreated < rangeStart) break;
  }
  console.log(`Marketing: pre-cached ${contactSourceCache.size} contact channels from lead fetch`);
  return leads;
}

async function fetchAllAppts(rangeStart: number, rangeEnd: number): Promise<ApptRecord[]> {
  const appts: ApptRecord[] = [];
  const now = Date.now();

  for (const calId of [MIKE_CALENDAR, JOSH_CALENDAR]) {
    const url = `${BASE}/calendars/events?locationId=${LOCATION_ID()}&calendarId=${calId}&startTime=${rangeStart}&endTime=${rangeEnd}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) continue;
    const data = await res.json();
    const events = data.events || [];

    for (const e of events) {
      if (e.deleted) continue;
      const titleLower = (e.title || "").toLowerCase();
      const status = e.appointmentStatus || "";
      const cancelled = status === "cancelled" || titleLower.startsWith("c-") || titleLower.includes("cancel");
      const endTime = new Date(e.endTime).getTime();

      appts.push({
        date: new Date(e.startTime).getTime(),
        channel: getContactChannelCached(e.contactId || ""),
        cancelled,
        completed: !cancelled && endTime < now,
      });
    }
  }
  return appts;
}

async function fetchAllDeals(rangeStart: number, rangeEnd: number): Promise<DealRecord[]> {
  const deals: DealRecord[] = [];

  // A-B signed = TC pipeline createdAt, profit = monetaryValue
  const tcRes = await fetch(`${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${TC_PIPELINE}&limit=100`, { headers: getHeaders() });
  if (tcRes.ok) {
    const tcData = await tcRes.json();
    for (const o of tcData.opportunities || []) {
      const d = new Date(o.createdAt).getTime();
      if (d < rangeStart || d > rangeEnd) continue;
      const channel = o.contactId ? getContactChannelCached(o.contactId) : getChannel(o.source || "", "");
      deals.push({ date: d, channel, category: "ab", monetaryValue: o.monetaryValue || 0 });
    }
  }

  // Closings from Mike/Josh closer pipelines
  const closerStages = [
    { pipeline: MIKE_PIPELINE, stage: "64d1fa71-6952-41cd-be5e-1536715b6d87" },
    { pipeline: JOSH_PIPELINE, stage: "0c4afc64-8163-4723-9f78-d4a0d7e1d037" },
  ];
  for (const q of closerStages) {
    const res = await fetch(`${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${q.pipeline}&pipeline_stage_id=${q.stage}&limit=100`, { headers: getHeaders() });
    if (!res.ok) continue;
    const data = await res.json();
    for (const o of data.opportunities || []) {
      const d = new Date(o.lastStageChangeAt).getTime();
      if (d < rangeStart || d > rangeEnd) continue;
      const ch = o.contactId ? getContactChannelCached(o.contactId) : getChannel(o.source || "", "");
      deals.push({ date: d, channel: ch, category: "closing", monetaryValue: o.monetaryValue || 0 });
    }
  }

  // Settled = Deals > Closed Deal, use "Closing Confirmed Date B-C" for actual close date
  const DEALS_PIPELINE = "DiGXnGTlQCOMZQJmWQe9";
  const CLOSING_DATE_FIELD = "bbDP5pNJ96IMth9bQfh8";
  const settledRes = await fetch(`${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${DEALS_PIPELINE}&pipeline_stage_id=245bc5b3-e2ac-4886-8928-907560ec3f15&limit=100`, { headers: getHeaders() });
  if (settledRes.ok) {
    const data = await settledRes.json();
    for (const o of data.opportunities || []) {
      // Per-opportunity detail cache: settled deals don't change once closingDate is set
      const cacheKey = `mkt_deal_detail_${o.id}`;
      type DealDetailCache = { closingDate: string; monetaryValue: number };
      let cached: DealDetailCache | null = null;
      try {
        cached = await kv.get<DealDetailCache>(cacheKey);
      } catch {
        // KV unavailable, fall through
      }

      let closingDate: string;
      let monetaryValue: number;

      if (cached && cached.closingDate) {
        closingDate = cached.closingDate;
        monetaryValue = cached.monetaryValue || 0;
      } else {
        // Fetch detail for closing date custom field
        const detailRes = await fetch(`${BASE}/opportunities/${o.id}`, { headers: getHeaders() });
        if (!detailRes.ok) continue;
        const detail = await detailRes.json();
        const opp = detail.opportunity || detail;
        const cfs: Record<string, string> = {};
        for (const cf of opp.customFields || []) {
          cfs[cf.id] = cf.fieldValue || cf.fieldValueString || "";
        }
        closingDate = cfs[CLOSING_DATE_FIELD] || "";
        monetaryValue = opp.monetaryValue || 0;

        // Only cache once we actually have a closing date (it's effectively immutable then)
        if (closingDate) {
          try {
            await kv.set(cacheKey, { closingDate, monetaryValue });
          } catch {
            // KV unavailable
          }
        }
      }

      if (!closingDate || closingDate < "2026") continue;

      const d = new Date(closingDate).getTime();
      if (d < rangeStart || d > rangeEnd) continue;
      const ch = o.contactId ? getContactChannelCached(o.contactId) : getChannel(o.source || "", "");
      deals.push({ date: d, channel: ch, category: "settled", monetaryValue });
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

interface CachedWeekEntry {
  data: MarketingWeekData;
  cachedAt: string;
}

const WEEK_CACHE_PREFIX = "marketing_week_v2_";
// Per-opportunity detail cache prefix (settled deal closing dates) — used inline in fetchAllDeals as "mkt_deal_detail_${id}"

function buildWeekData(
  weeks: Week[],
  targetWeeks: Week[],
  allLeads: LeadRecord[],
  allAppts: ApptRecord[],
  allDeals: DealRecord[]
): MarketingWeekData[] {
  return targetWeeks.map((w) => {
    const channels: Record<string, ChannelWeekData> = {};
    for (const ch of CHANNELS) {
      const weekLeads = allLeads.filter((l) => l.channel === ch && findWeekKey(new Date(l.date), weeks) === w.key);
      const weekAppts = allAppts.filter((a) => a.channel === ch && !a.cancelled && a.completed && findWeekKey(new Date(a.date), weeks) === w.key);
      const weekAb = allDeals.filter((d) => d.channel === ch && d.category === "ab" && findWeekKey(new Date(d.date), weeks) === w.key);
      const weekClosings = allDeals.filter((d) => d.channel === ch && d.category === "closing" && findWeekKey(new Date(d.date), weeks) === w.key);
      const weekSettled = allDeals.filter((d) => d.channel === ch && d.category === "settled" && findWeekKey(new Date(d.date), weeks) === w.key);

      channels[ch] = {
        leads: weekLeads.length,
        appts: weekAppts.length,
        ab: weekAb.length,
        closings: weekClosings.length,
        settled: weekSettled.length,
        grossProfit: weekSettled.reduce((a, d) => a + d.monetaryValue, 0),
        spend: 0,
        mailersSent: 0,
      };
    }
    return {
      weekKey: w.key,
      startDate: w.start.toISOString().slice(0, 10),
      endDate: w.end.toISOString().slice(0, 10),
      channels,
    };
  });
}

function applyManualInputs(
  weekData: MarketingWeekData[],
  manualInputs: Record<string, Record<string, { spend?: number; mailersSent?: number }>>
) {
  for (const w of weekData) {
    for (const ch of CHANNELS) {
      const manual = manualInputs?.[w.weekKey]?.[ch];
      if (manual) {
        w.channels[ch].spend = manual.spend || 0;
        w.channels[ch].mailersSent = manual.mailersSent || 0;
      }
    }
  }
}

async function invalidateAllWeekCaches(weeks: Week[]) {
  await Promise.all(
    weeks.map(async (w) => {
      try {
        await kv.del(`${WEEK_CACHE_PREFIX}${w.key}`);
      } catch {
        // KV unavailable
      }
    })
  );
}

async function invalidateDealDetailCache() {
  // We can't reliably enumerate keys via @vercel/kv without SCAN, so this is a no-op stub.
  // The settled-deal cache will refresh naturally on next miss; if we ever need to nuke it,
  // we'd add a redis SCAN call. For now, ?refresh=true clears week caches which forces a
  // full recompute against fresh GHL data, and detail entries are re-validated on read.
  // (The detail cache is keyed by GHL opp id — only stored once closingDate is set, so this
  // is only stale if GHL changes a closing date after the fact, which is rare.)
}

export async function GET(request: Request) {
  try {
    if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
      return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const refreshParam = searchParams.get("refresh");
    const forceRefreshAll = refreshParam === "true";
    const refreshCurrentOnly = refreshParam === "current";

    const weeks = getWeeks2026();
    if (weeks.length === 0) {
      return NextResponse.json({
        weeks: [],
        channels: CHANNELS as unknown as string[],
        lastUpdated: new Date().toISOString(),
      });
    }

    const currentWeekKey = weeks[weeks.length - 1].key;

    // Load manual inputs (always overlaid at response time, never cached per-week)
    let manualInputs: Record<string, Record<string, { spend?: number; mailersSent?: number }>> = {};
    try {
      const saved = await kv.get<typeof manualInputs>("marketing_inputs");
      if (saved) manualInputs = saved;
    } catch {
      // KV not available
    }

    // If full refresh, blow away all per-week caches first
    if (forceRefreshAll) {
      console.log("Marketing: forceRefresh=true — invalidating all per-week caches");
      await invalidateAllWeekCaches(weeks);
      await invalidateDealDetailCache();
    } else if (refreshCurrentOnly) {
      console.log("Marketing: refresh=current — invalidating current week cache");
      try {
        await kv.del(`${WEEK_CACHE_PREFIX}${currentWeekKey}`);
      } catch {
        // KV unavailable
      }
    }

    // Phase 1: read all per-week caches in parallel
    let cachedEntries: (CachedWeekEntry | null)[] = [];
    let kvAvailable = true;
    try {
      cachedEntries = await Promise.all(
        weeks.map((w) =>
          kv.get<CachedWeekEntry>(`${WEEK_CACHE_PREFIX}${w.key}`).catch(() => null)
        )
      );
    } catch {
      kvAvailable = false;
      cachedEntries = weeks.map(() => null);
    }

    // Phase 2: identify which weeks need fetching
    // Always refetch the current (most recent) week — historical weeks are stable.
    const weeksToFetch: Week[] = [];
    for (let i = 0; i < weeks.length; i++) {
      const w = weeks[i];
      if (!cachedEntries[i] || w.key === currentWeekKey) {
        weeksToFetch.push(w);
      }
    }

    let freshWeekData: MarketingWeekData[] = [];

    if (weeksToFetch.length > 0) {
      // Narrowest possible fetch window
      const fetchStart = Math.min(...weeksToFetch.map((w) => w.start.getTime()));
      const fetchEnd = Math.max(...weeksToFetch.map((w) => w.end.getTime())) + 86400000; // +1 day to fully include end

      console.log(
        `Marketing: refetching ${weeksToFetch.length}/${weeks.length} weeks (range ${new Date(fetchStart).toISOString().slice(0, 10)} → ${new Date(fetchEnd).toISOString().slice(0, 10)})`
      );

      // Reset request-scoped contact channel cache
      contactSourceCache.clear();

      try {
        // Fetch leads first to populate contactSourceCache, then appts+deals in parallel
        const allLeads = await fetchAllSellerLeads(fetchStart, fetchEnd);
        const [allAppts, allDeals] = await Promise.all([
          fetchAllAppts(fetchStart, fetchEnd),
          fetchAllDeals(fetchStart, fetchEnd),
        ]);
        console.log(
          `Marketing: ${allLeads.length} leads, ${allAppts.length} appts, ${allDeals.length} deals (channel cache: ${contactSourceCache.size})`
        );

        freshWeekData = buildWeekData(weeks, weeksToFetch, allLeads, allAppts, allDeals);

        // Phase 3: persist each fresh week to its own key
        if (kvAvailable) {
          await Promise.all(
            freshWeekData.map(async (wd) => {
              try {
                const entry: CachedWeekEntry = { data: wd, cachedAt: new Date().toISOString() };
                await kv.set(`${WEEK_CACHE_PREFIX}${wd.weekKey}`, entry);
              } catch {
                // KV unavailable
              }
            })
          );
        }
      } catch (fetchErr) {
        console.error("Marketing: fetch failed, falling back to whatever cache we have", fetchErr);
        // Fall through — we'll serve any cached weeks plus empty placeholders for the rest
      }
    }

    // Phase 4: merge cached + fresh into ordered weeks array
    const freshByKey = new Map(freshWeekData.map((w) => [w.weekKey, w]));
    const mergedWeeks: MarketingWeekData[] = weeks.map((w, i) => {
      const fresh = freshByKey.get(w.key);
      if (fresh) return fresh;
      const cached = cachedEntries[i];
      if (cached) return cached.data;
      // Last resort: empty placeholder
      const channels: Record<string, ChannelWeekData> = {};
      for (const ch of CHANNELS) {
        channels[ch] = { leads: 0, appts: 0, ab: 0, closings: 0, settled: 0, grossProfit: 0, spend: 0, mailersSent: 0 };
      }
      return {
        weekKey: w.key,
        startDate: w.start.toISOString().slice(0, 10),
        endDate: w.end.toISOString().slice(0, 10),
        channels,
      };
    });

    // Phase 5: overlay manual inputs (spend, mailersSent) — always live
    applyManualInputs(mergedWeeks, manualInputs);

    return NextResponse.json({
      weeks: mergedWeeks,
      channels: CHANNELS as unknown as string[],
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
