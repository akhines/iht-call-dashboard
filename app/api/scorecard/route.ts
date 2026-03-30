import { NextResponse } from "next/server";

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

// Calendar IDs
const MIKE_CALENDAR = "1pRjeG5QkespBBQK3u1s";
const JOSH_CALENDAR = "19xfzyb7vedvmzqNf8FK";

// Pipeline IDs
const MIKE_PIPELINE = "nwSjS0rUTMGbgDvyrEe4";
const JOSH_PIPELINE = "ggnBpwig6OE37fXPQv7a";
// const DEALS_PIPELINE = "DiGXnGTlQCOMZQJmWQe9";
const TC_PIPELINE = "ofMQolXiKGyg6WNOJS88";

// Stage IDs
const STAGES = {
  mikeOfferMade: "cdd65b88-c954-4f80-bd23-3d4dced615ad",
  joshOffered: "d6a230e1-fc7d-4881-b238-70b83230dfc4",
  tcBcAssigned: "79163384-97f7-4b12-a3ca-a15c092f04f4",
  tcClosedDispo: "8464b838-cb2d-497a-89f6-07c4025ae17f",
};

const OPP_FIELDS = {
  abPrice: "auq20sgMLdGuBqt5f94I",
  bcPrice: "eYnQy81LxuYK5Wxwjv5W",
  grossProfit: "xCCFXqTAVdFowPoJWEz6",
};

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
    weeks.push({
      start: new Date(current),
      end: new Date(Math.min(end.getTime(), now.getTime())),
      key: current.toISOString().slice(0, 10),
    });
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

interface CallRecord {
  date: number;
  direction: string;
  duration: number;
  connected: boolean;
}

async function fetchAllCalls2026(): Promise<CallRecord[]> {
  const allCalls: CallRecord[] = [];

  // Get all TYPE_CALL conversations, paginating
  let startAfterDate: number | null = null;
  for (let page = 0; page < 20; page++) {
    let url = `${BASE}/conversations/search?locationId=${LOCATION_ID()}&limit=100&lastMessageType=TYPE_CALL&sort_by=last_message_date&sort_order=desc`;
    if (startAfterDate) url += `&startAfterDate=${startAfterDate}`;

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    const convs = data.conversations || [];
    if (convs.length === 0) break;

    // Stop if we've gone before 2026
    const lastDate = convs[convs.length - 1].lastMessageDate;
    const convIds = convs
      .filter((c: { lastMessageDate: number }) => c.lastMessageDate >= JAN1_2026)
      .map((c: { id: string }) => c.id);

    // Fetch messages in batches
    const batchSize = 10;
    for (let i = 0; i < convIds.length; i += batchSize) {
      const batch = convIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (convId: string) => {
          const msgRes = await fetch(`${BASE}/conversations/${convId}/messages`, { headers: getHeaders() });
          if (!msgRes.ok) return [];
          const msgData = await msgRes.json();
          let msgs = msgData.messages || [];
          if (msgs && typeof msgs === "object" && !Array.isArray(msgs)) msgs = msgs.messages || [];
          return msgs;
        })
      );

      for (const msgs of results) {
        for (const msg of msgs) {
          const mt = msg.messageType || "";
          if (!mt.includes("CALL")) continue;
          const msgDate = new Date(msg.dateAdded).getTime();
          if (msgDate < JAN1_2026) continue;

          const isInbound = msg.direction === "inbound" || mt === "TYPE_IVR_CALL";
          const duration = msg.meta?.call?.duration || 0;
          const status = msg.meta?.call?.status || msg.status || "";

          allCalls.push({
            date: msgDate,
            direction: isInbound ? "inbound" : "outbound",
            duration,
            connected: status === "completed" && duration >= 20,
          });
        }
      }
    }

    if (lastDate < JAN1_2026) break;
    startAfterDate = lastDate;
    if (convs.length < 100) break;
  }

  return allCalls;
}

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
  cancelled: boolean;
  completed: boolean;
  rescheduled: boolean;
  title: string;
}

async function fetchAllAppointments2026(): Promise<ApptRecord[]> {
  const appts: ApptRecord[] = [];
  const now = Date.now();

  for (const calId of [MIKE_CALENDAR, JOSH_CALENDAR]) {
    const url = `${BASE}/calendars/events?locationId=${LOCATION_ID()}&calendarId=${calId}&startTime=${JAN1_2026}&endTime=${now}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) continue;
    const data = await res.json();

    for (const e of data.events || []) {
      if (e.deleted) continue;
      const startTime = new Date(e.startTime).getTime();
      const endTime = new Date(e.endTime).getTime();
      const title = (e.title || "").toLowerCase();
      const status = e.appointmentStatus || "";

      const cancelled = status === "cancelled" || title.startsWith("c-") || title.includes("cancel");
      const completed = !cancelled && endTime < now;

      appts.push({
        date: startTime,
        calendarId: calId,
        cancelled,
        completed,
        rescheduled: title.includes("reschedul"),
        title: e.title || "",
      });
    }
  }

  return appts;
}

interface OppRecord {
  date: number; // the date to bucket by
  category: "offer_mike" | "offer_josh" | "ab_signed" | "bc_signed" | "settled";
  name: string;
  source: string;
  abPrice: number;
  bcPrice: number;
  grossProfit: number;
}

async function fetchOppsByStage(pipelineId: string, stageId: string): Promise<{ id: string; name: string; source: string; lastStageChangeAt: string; createdAt: string }[]> {
  const results: { id: string; name: string; source: string; lastStageChangeAt: string; createdAt: string }[] = [];
  const url = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pipelineId}&pipeline_stage_id=${stageId}&limit=100`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return results;
  const data = await res.json();
  for (const o of data.opportunities || []) {
    results.push({ id: o.id, name: o.name || "", source: o.source || "", lastStageChangeAt: o.lastStageChangeAt, createdAt: o.createdAt });
  }
  return results;
}

async function fetchAllOpportunities2026(): Promise<OppRecord[]> {
  const opps: OppRecord[] = [];

  // Offers: Mike "Offer Made" and Josh "Offered" - use lastStageChangeAt
  const [mikeOffers, joshOffers, bcAssigned, closedDispo] = await Promise.all([
    fetchOppsByStage(MIKE_PIPELINE, STAGES.mikeOfferMade),
    fetchOppsByStage(JOSH_PIPELINE, STAGES.joshOffered),
    fetchOppsByStage(TC_PIPELINE, STAGES.tcBcAssigned),
    fetchOppsByStage(TC_PIPELINE, STAGES.tcClosedDispo),
  ]);

  for (const o of mikeOffers) {
    const d = new Date(o.lastStageChangeAt).getTime();
    if (d >= JAN1_2026) opps.push({ date: d, category: "offer_mike", name: o.name, source: o.source, abPrice: 0, bcPrice: 0, grossProfit: 0 });
  }
  for (const o of joshOffers) {
    const d = new Date(o.lastStageChangeAt).getTime();
    if (d >= JAN1_2026) opps.push({ date: d, category: "offer_josh", name: o.name, source: o.source, abPrice: 0, bcPrice: 0, grossProfit: 0 });
  }

  // A-B signed: ALL TC pipeline opps, use createdAt as the date they entered TC
  const tcAllUrl = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${TC_PIPELINE}&limit=100`;
  const tcAllRes = await fetch(tcAllUrl, { headers: getHeaders() });
  if (tcAllRes.ok) {
    const tcData = await tcAllRes.json();
    for (const o of tcData.opportunities || []) {
      const d = new Date(o.createdAt).getTime();
      if (d >= JAN1_2026) {
        opps.push({ date: d, category: "ab_signed", name: o.name || "", source: o.source || "", abPrice: 0, bcPrice: 0, grossProfit: 0 });
      }
    }
  }

  // B-C signed: TC "B-C Assigned" stage, use lastStageChangeAt
  for (const o of bcAssigned) {
    const d = new Date(o.lastStageChangeAt).getTime();
    if (d >= JAN1_2026) opps.push({ date: d, category: "bc_signed", name: o.name, source: o.source, abPrice: 0, bcPrice: 0, grossProfit: 0 });
  }

  // Settled: TC "Closed - Dispo Complete", fetch detail for pricing
  for (const o of closedDispo) {
    const d = new Date(o.lastStageChangeAt).getTime();
    if (d < JAN1_2026) continue;

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
    opps.push({ date: d, category: "settled", name: o.name, source: o.source, abPrice, bcPrice, grossProfit });
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
}

export async function GET() {
  try {
    if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
      return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
    }

    const weeks = getWeeks2026();

    // Fetch all data in parallel
    console.log("Scorecard: fetching all GHL data...");
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
      const grossProfit = settledOpps.reduce((a, o) => a + (o.grossProfit || (o.bcPrice - o.abPrice)), 0);

      // Source breakdowns
      const leadsBySource: SourceBreakdown = {};
      weekSellers.filter((s) => s.hasAddress).forEach((s) => {
        const src = s.source || "Unknown";
        leadsBySource[src] = (leadsBySource[src] || 0) + 1;
      });

      const apptsBySource: SourceBreakdown = {};
      weekAppts.filter((a) => !a.cancelled).forEach((a) => {
        // Extract source from appointment title (e.g. "*TV" suffix)
        const t = a.title;
        let src = "Other";
        if (t.includes("*TV") || t.includes("*tv")) src = "TV";
        else if (t.includes("*DM") || t.includes("Direct Mail")) src = "Direct Mail";
        else if (t.includes("PPC") || t.includes("Google")) src = "Google Ads";
        else if (t.includes("SEO")) src = "SEO";
        apptsBySource[src] = (apptsBySource[src] || 0) + 1;
      });

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
        bookingPct: prospects > 0 ? Math.round((totalBooked / prospects) * 10000) / 100 : 0,
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
      };
    });

    return NextResponse.json({
      weeks: weekData,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Scorecard API error:", error);
    return NextResponse.json(
      { error: "Failed to build scorecard" },
      { status: 500 }
    );
  }
}
