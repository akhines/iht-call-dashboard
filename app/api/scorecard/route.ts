import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { fetchAllCalls2026 } from "@/app/lib/ghl-calls";

export const dynamic = "force-dynamic";

const CACHE_KEY = "scorecard_cache";

interface CachedData {
  weekNumber: number;
  data: { weeks: WeekData[]; lastUpdated: string };
}

function getCurrentWeekNumber(): number {
  const now = new Date();
  const start = new Date("2026-01-05T00:00:00Z");
  return Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

const BASE = "https://services.leadconnectorhq.com";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
}

const LOCATION_ID = () => process.env.GHL_LOCATION_ID!;

// Calendar IDs
const MIKE_CALENDAR = "1pRjeG5QkespBBQK3u1s";
const JOSH_CALENDAR = "19xfzyb7vedvmzqNf8FK";

// Pipeline IDs
const MIKE_PIPELINE = "nwSjS0rUTMGbgDvyrEe4";
const JOSH_PIPELINE = "ggnBpwig6OE37fXPQv7a";
const DEALS_PIPELINE = "DiGXnGTlQCOMZQJmWQe9";
const TC_PIPELINE = "ofMQolXiKGyg6WNOJS88";

// Stage IDs
const STAGES = {
  mikeOfferMade: "cdd65b88-c954-4f80-bd23-3d4dced615ad",
  joshOffered: "d6a230e1-fc7d-4881-b238-70b83230dfc4",
  tcBcAssigned: "79163384-97f7-4b12-a3ca-a15c092f04f4",
  tcClosedDispo: "8464b838-cb2d-497a-89f6-07c4025ae17f",
  dealsClosedDeal: "245bc5b3-e2ac-4886-8928-907560ec3f15",
};

// Profit comes from monetaryValue on the opportunity

const CONTACT_TYPE_FIELD = "IfkLFRqVzW9XrCkXvPUQ";

const JAN1_2026 = new Date("2026-01-01T00:00:00Z").getTime();

// ============ WEEK HELPERS ============

interface Week {
  start: Date;
  end: Date;
  key: string; // "2026-01-05"
}

function getWeeks2026(): Week[] {
  const weeks: Week[] = [];
  const current = new Date("2026-01-05T00:00:00Z");
  const now = new Date();

  while (current < now) {
    const end = new Date(current);
    end.setDate(end.getDate() + 6);
    // Only include completed weeks (end date has passed)
    if (end.getTime() < now.getTime()) {
      weeks.push({
        start: new Date(current),
        end: new Date(end),
        key: current.toISOString().slice(0, 10),
      });
    }
    current.setDate(current.getDate() + 7);
  }
  return weeks;
}

function findWeekKey(date: Date, weeks: Week[]): string | null {
  const t = date.getTime();
  for (const w of weeks) {
    if (t >= w.start.getTime() && t <= w.end.getTime() + 86400000) {
      return w.key;
    }
  }
  return null;
}

// ============ DATA FETCHERS (fetch ALL, then bucket) ============

// CallRecord type imported from shared module as SimpleCallRecord

interface SellerContact {
  dateAdded: number;
  hasAddress: boolean;
  source: string;
}

async function fetchAllSellerContacts2026(): Promise<SellerContact[]> {
  const sellers: SellerContact[] = [];
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
        sellers.push({
          dateAdded: created,
          hasAddress: !!(c.address1 && c.address1.trim()),
          source: c.source || "",
        });
      }
    }

    const meta = data.meta || {};
    if (!meta.nextPageUrl) break;
    startAfterId = meta.startAfterId || "";
    startAfter = meta.startAfter || 0;

    // Contacts are newest-first; if last one is before 2026, stop
    const lastCreated = new Date(contacts[contacts.length - 1].dateAdded).getTime();
    if (lastCreated < JAN1_2026) break;
  }

  return sellers;
}

interface ApptRecord {
  date: number;
  calendarId: string;
  closer: string; // "Mike" or "Josh"
  cancelled: boolean;
  completed: boolean;
  rescheduled: boolean;
  source: string;
  title: string;
}

const MARKETING_CAMPAIGN_FIELD = "4fOhwf1m5nhK1c9vI6SJ";
const contactSourceCache = new Map<string, string>();

async function getContactSource(contactId: string): Promise<string> {
  if (!contactId) return "Other";
  if (contactSourceCache.has(contactId)) return contactSourceCache.get(contactId)!;
  const res = await fetch(`${BASE}/contacts/${contactId}`, { headers: getHeaders() });
  if (!res.ok) { contactSourceCache.set(contactId, "Other"); return "Other"; }
  const data = await res.json();
  const c = data.contact || {};
  const cfs: Record<string, string> = {};
  for (const cf of c.customFields || []) cfs[cf.id] = cf.value;
  const campaign = cfs[MARKETING_CAMPAIGN_FIELD] || "";
  const src = c.source || campaign || "Other";
  contactSourceCache.set(contactId, src);
  return src;
}

async function fetchAllAppointments2026(): Promise<ApptRecord[]> {
  const appts: ApptRecord[] = [];
  const now = Date.now();

  for (const calId of [MIKE_CALENDAR, JOSH_CALENDAR]) {
    const closer = calId === MIKE_CALENDAR ? "Mike" : "Josh";
    const url = `${BASE}/calendars/events?locationId=${LOCATION_ID()}&calendarId=${calId}&startTime=${JAN1_2026}&endTime=${now}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) continue;
    const data = await res.json();
    const events = data.events || [];

    // Batch contact lookups for source
    const batchSize = 10;
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      const sources = await Promise.all(
        batch.map((e: { contactId?: string }) => getContactSource(e.contactId || ""))
      );
      batch.forEach((e: { deleted?: boolean; title?: string; appointmentStatus?: string; startTime: string; endTime: string }, idx: number) => {
        if (e.deleted) return;
        const titleLower = (e.title || "").toLowerCase();
        const status = e.appointmentStatus || "";
        const cancelled = status === "cancelled" || titleLower.startsWith("c-") || titleLower.includes("cancel");
        const endTime = new Date(e.endTime).getTime();

        appts.push({
          date: new Date(e.startTime).getTime(),
          calendarId: calId,
          closer,
          cancelled,
          completed: !cancelled && endTime < now,
          rescheduled: titleLower.includes("reschedul"),
          source: sources[idx],
          title: e.title || "",
        });
      });
    }
  }

  return appts;
}

interface OppRecord {
  date: number;
  category: "offer_mike" | "offer_josh" | "ab_signed" | "bc_signed" | "settled";
  closer: string;
  name: string;
  source: string;
  monetaryValue: number;
}

interface OppSearchResult { id: string; name: string; source: string; contactId: string; lastStageChangeAt: string; createdAt: string; monetaryValue: number; }

async function fetchOppsByStage(pipelineId: string, stageId: string): Promise<OppSearchResult[]> {
  const results: OppSearchResult[] = [];
  const url = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pipelineId}&pipeline_stage_id=${stageId}&limit=100`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return results;
  const data = await res.json();
  for (const o of data.opportunities || []) {
    results.push({ id: o.id, name: o.name || "", source: o.source || "", contactId: o.contactId || "", lastStageChangeAt: o.lastStageChangeAt, createdAt: o.createdAt, monetaryValue: o.monetaryValue || 0 });
  }
  return results;
}

async function fetchAllOpportunities2026(): Promise<OppRecord[]> {
  const opps: OppRecord[] = [];

  // Offers: Mike "Offer Made" and Josh "Offered" - use lastStageChangeAt
  const [mikeOffers, joshOffers, bcAssigned, closedDeals] = await Promise.all([
    fetchOppsByStage(MIKE_PIPELINE, STAGES.mikeOfferMade),
    fetchOppsByStage(JOSH_PIPELINE, STAGES.joshOffered),
    fetchOppsByStage(TC_PIPELINE, STAGES.tcBcAssigned),
    fetchOppsByStage(DEALS_PIPELINE, STAGES.dealsClosedDeal),
  ]);

  for (const o of mikeOffers) {
    const d = new Date(o.lastStageChangeAt).getTime();
    const src = o.contactId ? await getContactSource(o.contactId) : o.source;
    if (d >= JAN1_2026) opps.push({ date: d, category: "offer_mike", closer: "Mike", name: o.name, source: src, monetaryValue: 0 });
  }
  for (const o of joshOffers) {
    const d = new Date(o.lastStageChangeAt).getTime();
    const src = o.contactId ? await getContactSource(o.contactId) : o.source;
    if (d >= JAN1_2026) opps.push({ date: d, category: "offer_josh", closer: "Josh", name: o.name, source: src, monetaryValue: 0 });
  }

  // A-B signed: ALL TC pipeline opps, use createdAt as the date they entered TC
  const tcAllUrl = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${TC_PIPELINE}&limit=100`;
  const tcAllRes = await fetch(tcAllUrl, { headers: getHeaders() });
  if (tcAllRes.ok) {
    const tcData = await tcAllRes.json();
    for (const o of tcData.opportunities || []) {
      const d = new Date(o.createdAt).getTime();
      if (d >= JAN1_2026) {
        const src = o.contactId ? await getContactSource(o.contactId) : (o.source || "");
        const isMike = mikeOffers.some((m) => m.contactId === o.contactId);
        opps.push({ date: d, category: "ab_signed", closer: isMike ? "Mike" : "Josh", name: o.name || "", source: src, monetaryValue: o.monetaryValue || 0 });
      }
    }
  }

  // B-C signed: TC "B-C Assigned" stage, use lastStageChangeAt
  for (const o of bcAssigned) {
    const d = new Date(o.lastStageChangeAt).getTime();
    const src = o.contactId ? await getContactSource(o.contactId) : o.source;
    const isMike = mikeOffers.some((m) => m.contactId === o.contactId);
    if (d >= JAN1_2026) opps.push({ date: d, category: "bc_signed", closer: isMike ? "Mike" : "Josh", name: o.name, source: src, monetaryValue: 0 });
  }

  // Settled: Deals > Closed Deal, use "Closing Confirmed Date B-C" custom field for date
  const CLOSING_DATE_FIELD = "bbDP5pNJ96IMth9bQfh8";
  for (const o of closedDeals) {
    // Fetch detail to get closing date custom field
    const detailRes = await fetch(`${BASE}/opportunities/${o.id}`, { headers: getHeaders() });
    if (!detailRes.ok) continue;
    const detail = await detailRes.json();
    const opp = detail.opportunity || detail;
    const cfs: Record<string, string> = {};
    for (const cf of opp.customFields || []) {
      cfs[cf.id] = cf.fieldValue || cf.fieldValueString || "";
    }
    const closingDate = cfs[CLOSING_DATE_FIELD];
    if (!closingDate || closingDate < "2026") continue;

    const d = new Date(closingDate).getTime();
    if (d < JAN1_2026) continue;
    const src = o.contactId ? await getContactSource(o.contactId) : o.source;
    const isMike = mikeOffers.some((m) => m.contactId === o.contactId);
    opps.push({ date: d, category: "settled", closer: isMike ? "Mike" : "Josh", name: o.name, source: src, monetaryValue: opp.monetaryValue || 0 });
  }

  return opps;
}

// ============ BUILD WEEKLY SCORECARD ============

interface SourceBreakdown {
  [source: string]: number;
}

export interface WeekData {
  startDate: string;
  endDate: string;
  dials: number;
  totalInbound: number;
  pickUpRate: number;
  missedCalls: number;
  connects: number;
  avgCallDuration: number;
  connectRate: number;
  leads: number;
  prospects: number;
  bookingPct: number;
  inPersonBooked: number;
  virtualBooked: number;
  cancelledInPerson: number;
  cancelledVirtual: number;
  rescheduled: number;
  inPersonCompleted: number;
  virtualCompleted: number;
  showRateInPerson: number;
  showRateVirtual: number;
  inPersonOffers: number;
  virtualOffers: number;
  abSigned: number;
  bcSigned: number;
  settled: number;
  grossProfit: number;
  netProfit: number;
  // Source breakdowns for drilldowns
  leadsBySource: SourceBreakdown;
  apptsBySource: SourceBreakdown;
  abBySource: SourceBreakdown;
  settledBySource: SourceBreakdown;
  // Closer breakdown
  mikeAppts: number;
  mikeOffers: number;
  mikeSigned: number;
  mikeSettled: number;
  joshAppts: number;
  joshOffers: number;
  joshSigned: number;
  joshSettled: number;
}

export async function GET(request: Request) {
  try {
    if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
      return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "true";
    const currentWeek = getCurrentWeekNumber();

    // Check cache (unless force refresh)
    if (!forceRefresh) {
      try {
        const cached = await kv.get<CachedData>(CACHE_KEY);
        if (cached && cached.weekNumber === currentWeek) {
          console.log("Scorecard: serving from cache");
          return NextResponse.json(cached.data);
        }
      } catch {
        // KV not available, proceed with fresh fetch
      }
    }

    const weeks = getWeeks2026();

    // Fetch all data in parallel
    console.log("Scorecard: fetching fresh GHL data...");
    const [allCalls, allSellers, allAppts, allOpps] = await Promise.all([
      fetchAllCalls2026(),
      fetchAllSellerContacts2026(),
      fetchAllAppointments2026(),
      fetchAllOpportunities2026(),
    ]);
    console.log(`Scorecard: ${allCalls.length} calls, ${allSellers.length} sellers, ${allAppts.length} appts, ${allOpps.length} opps`);

    // Bucket data by week
    const weekData: WeekData[] = weeks.map((w) => {
      // Calls for this week
      const weekCalls = allCalls.filter((c) => {
        const wk = findWeekKey(new Date(c.date), weeks);
        return wk === w.key;
      });
      const dials = weekCalls.filter((c) => c.direction === "outbound").length;
      const totalInbound = weekCalls.filter((c) => c.direction === "inbound").length;
      const totalCallCount = dials + totalInbound;
      const connects = weekCalls.filter((c) => c.connected).length;
      const missedCalls = totalCallCount - connects;
      const connectedCalls = weekCalls.filter((c) => c.connected);
      const totalDuration = connectedCalls.reduce((a, c) => a + c.duration, 0);
      const avgCallDuration = connectedCalls.length > 0 ? Math.round(totalDuration / connectedCalls.length) : 0;

      // Contacts for this week
      const weekSellers = allSellers.filter((s) => {
        const wk = findWeekKey(new Date(s.dateAdded), weeks);
        return wk === w.key;
      });
      const leads = weekSellers.filter((s) => s.hasAddress).length;
      const prospects = weekSellers.length;

      // Appointments for this week
      const weekAppts = allAppts.filter((a) => {
        const wk = findWeekKey(new Date(a.date), weeks);
        return wk === w.key;
      });
      const inPersonAppts = weekAppts.filter((a) => a.calendarId === MIKE_CALENDAR);
      const virtualAppts = weekAppts.filter((a) => a.calendarId === JOSH_CALENDAR);

      const inPersonBooked = inPersonAppts.length;
      const virtualBooked = virtualAppts.length;
      const cancelledInPerson = inPersonAppts.filter((a) => a.cancelled).length;
      const cancelledVirtual = virtualAppts.filter((a) => a.cancelled).length;
      const rescheduled = weekAppts.filter((a) => a.rescheduled).length;
      const inPersonCompleted = inPersonAppts.filter((a) => a.completed).length;
      const virtualCompleted = virtualAppts.filter((a) => a.completed).length;

      const totalBooked = inPersonBooked + virtualBooked;

      // Opportunities for this week
      const weekOpps = allOpps.filter((o) => {
        const wk = findWeekKey(new Date(o.date), weeks);
        return wk === w.key;
      });

      const inPersonOffers = weekOpps.filter((o) => o.category === "offer_mike").length;
      const virtualOffers = weekOpps.filter((o) => o.category === "offer_josh").length;
      const abSigned = weekOpps.filter((o) => o.category === "ab_signed").length;
      const bcSigned = weekOpps.filter((o) => o.category === "bc_signed").length;
      const settledOpps = weekOpps.filter((o) => o.category === "settled");
      const settled = settledOpps.length;
      const grossProfit = settledOpps.reduce((a, o) => a + o.monetaryValue, 0);

      // Source breakdowns
      const leadsBySource: SourceBreakdown = {};
      weekSellers.filter((s) => s.hasAddress).forEach((s) => {
        const src = s.source || "Unknown";
        leadsBySource[src] = (leadsBySource[src] || 0) + 1;
      });

      // Now using contact source for appointments
      const apptsBySource: SourceBreakdown = {};
      weekAppts.filter((a) => !a.cancelled).forEach((a) => {
        const src = a.source || "Other";
        apptsBySource[src] = (apptsBySource[src] || 0) + 1;
      });

      const abBySource: SourceBreakdown = {};
      weekOpps.filter((o) => o.category === "ab_signed").forEach((o) => {
        const src = o.source || "Other";
        abBySource[src] = (abBySource[src] || 0) + 1;
      });

      const settledBySource: SourceBreakdown = {};
      settledOpps.forEach((o) => {
        const src = o.source || "Other";
        settledBySource[src] = (settledBySource[src] || 0) + 1;
      });

      // Closer breakdown
      const mikeAppts = weekAppts.filter((a) => a.closer === "Mike" && !a.cancelled).length;
      const joshAppts = weekAppts.filter((a) => a.closer === "Josh" && !a.cancelled).length;

      return {
        startDate: w.start.toISOString().slice(0, 10),
        endDate: w.end.toISOString().slice(0, 10),
        dials,
        totalInbound,
        pickUpRate: totalCallCount > 0 ? Math.round((connects / totalCallCount) * 10000) / 100 : 0,
        missedCalls,
        connects,
        avgCallDuration,
        connectRate: totalCallCount > 0 ? Math.round((connects / totalCallCount) * 10000) / 100 : 0,
        leads,
        prospects,
        bookingPct: leads > 0 ? Math.round((totalBooked / leads) * 10000) / 100 : 0,
        inPersonBooked,
        virtualBooked,
        cancelledInPerson,
        cancelledVirtual,
        rescheduled,
        inPersonCompleted,
        virtualCompleted,
        showRateInPerson: inPersonBooked > 0 ? Math.round((inPersonCompleted / inPersonBooked) * 10000) / 100 : 0,
        showRateVirtual: virtualBooked > 0 ? Math.round((virtualCompleted / virtualBooked) * 10000) / 100 : 0,
        inPersonOffers,
        virtualOffers,
        abSigned,
        bcSigned,
        settled,
        grossProfit,
        netProfit: 0,
        leadsBySource,
        apptsBySource,
        abBySource,
        settledBySource,
        mikeAppts,
        mikeOffers: weekOpps.filter((o) => o.category === "offer_mike").length,
        mikeSigned: weekOpps.filter((o) => o.category === "ab_signed" && o.closer === "Mike").length,
        mikeSettled: weekOpps.filter((o) => o.category === "settled" && o.closer === "Mike").length,
        joshAppts,
        joshOffers: weekOpps.filter((o) => o.category === "offer_josh").length,
        joshSigned: weekOpps.filter((o) => o.category === "ab_signed" && o.closer === "Josh").length,
        joshSettled: weekOpps.filter((o) => o.category === "settled" && o.closer === "Josh").length,
      };
    });

    const responseData = {
      weeks: weekData,
      lastUpdated: new Date().toISOString(),
    };

    // Cache for this week
    try {
      await kv.set(CACHE_KEY, { weekNumber: currentWeek, data: responseData });
      console.log("Scorecard: cached for week", currentWeek);
    } catch {
      // KV not available
    }

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Scorecard API error:", error);
    return NextResponse.json(
      { error: "Failed to build scorecard" },
      { status: 500 }
    );
  }
}
