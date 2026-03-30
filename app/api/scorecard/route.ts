import { NextResponse } from "next/server";

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
const MIKE_CALENDAR = "1pRjeG5QkespBBQK3u1s"; // In Person Appointments with Mike
const JOSH_CALENDAR = "19xfzyb7vedvmzqNf8FK"; // Offer Call with Josh (virtual)

// Pipeline IDs
// const LEADS_PIPELINE = "6tntgcGDlTyw30KUgRrS";
const MIKE_PIPELINE = "nwSjS0rUTMGbgDvyrEe4";
const JOSH_PIPELINE = "ggnBpwig6OE37fXPQv7a";
const DEALS_PIPELINE = "DiGXnGTlQCOMZQJmWQe9";
const TC_PIPELINE = "ofMQolXiKGyg6WNOJS88";

// Stage IDs
const STAGES = {
  // Mike
  mikeApptScheduled: "47ca5b20-f37a-4689-bcce-db719ab2fbe3",
  mikeOfferMade: "cdd65b88-c954-4f80-bd23-3d4dced615ad",
  mike1YdLine: "64d1fa71-6952-41cd-be5e-1536715b6d87",
  // Josh
  joshApptScheduled: "86baa3c7-ab3f-4d8b-b2b3-24955df8e97f",
  joshOffered: "d6a230e1-fc7d-4881-b238-70b83230dfc4",
  josh1YdLine: "f02c3be3-680d-46f7-b36f-766a8f72f39b",
  joshWon: "0c4afc64-8163-4723-9f78-d4a0d7e1d037",
  // Deals
  underContract: "c72967b1-115d-4ee5-8b27-c3a60d67137a",
  closedDeal: "245bc5b3-e2ac-4886-8928-907560ec3f15",
  // TC
  tcNewDeal: "1cfaafce-62f0-469c-8c1c-3b354a289559",
  tcBcAssigned: "79163384-97f7-4b12-a3ca-a15c092f04f4",
  tcReadyForDocusign: "4ee76e2e-e3b9-49c6-b0ad-5b081e3942bf",
  tcClosingScheduled: "5f2b5b2f-face-4733-ae83-52a1bcaf72da",
  tcClosedDispo: "8464b838-cb2d-497a-89f6-07c4025ae17f",
};

// Opportunity custom field IDs
const OPP_FIELDS = {
  abPrice: "auq20sgMLdGuBqt5f94I",
  bcPrice: "eYnQy81LxuYK5Wxwjv5W",
  grossProfit: "xCCFXqTAVdFowPoJWEz6",
};

// Contact custom field ID for seller/buyer type
const CONTACT_TYPE_FIELD = "IfkLFRqVzW9XrCkXvPUQ";

interface WeekData {
  startDate: string;
  endDate: string;
  // Calls
  dials: number;
  totalInbound: number;
  pickUpRate: number;
  missedCalls: number;
  connects: number;
  avgCallDuration: number;
  connectRate: number;
  // Contacts
  leads: number;
  prospects: number;
  bookingPct: number;
  // Appointments
  inPersonBooked: number;
  virtualBooked: number;
  cancelledInPerson: number;
  cancelledVirtual: number;
  rescheduled: number;
  inPersonCompleted: number;
  virtualCompleted: number;
  showRateInPerson: number;
  showRateVirtual: number;
  // Pipeline
  inPersonOffers: number;
  virtualOffers: number;
  abSigned: number;
  bcSigned: number;
  settled: number;
  grossProfit: number;
  netProfit: number;
}

function getWeeks2026(): { start: Date; end: Date }[] {
  const weeks: { start: Date; end: Date }[] = [];
  // Start from Monday Jan 5, 2026 (first full work week)
  const current = new Date("2026-01-05T00:00:00Z");
  const now = new Date();

  while (current < now) {
    const end = new Date(current);
    end.setDate(end.getDate() + 6); // Sunday
    if (end > now) {
      end.setTime(now.getTime());
    }
    weeks.push({ start: new Date(current), end: new Date(end) });
    current.setDate(current.getDate() + 7);
  }
  return weeks;
}

// Fetch calls for a date range
async function fetchCallsForRange(start: Date, end: Date) {
  const startTs = start.getTime();
  const endTs = end.getTime() + 86400000; // include end day

  // Search call conversations
  const url = `${BASE}/conversations/search?locationId=${LOCATION_ID()}&limit=100&lastMessageType=TYPE_CALL&sort_by=last_message_date&sort_order=desc`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return { dials: 0, totalInbound: 0, missedCalls: 0, connects: 0, totalDuration: 0 };

  const data = await res.json();
  const convs = data.conversations || [];

  let dials = 0, totalInbound = 0, missedCalls = 0, connects = 0, totalDuration = 0;

  // For each conversation, get messages
  const batchSize = 10;
  for (let i = 0; i < convs.length; i += batchSize) {
    const batch = convs.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (conv: { id: string; lastMessageDate: number }) => {
        const msgRes = await fetch(`${BASE}/conversations/${conv.id}/messages`, { headers: getHeaders() });
        if (!msgRes.ok) return [];
        const msgData = await msgRes.json();
        let msgs = msgData.messages || [];
        if (msgs && typeof msgs === "object" && !Array.isArray(msgs)) {
          msgs = msgs.messages || [];
        }
        return msgs;
      })
    );

    for (const msgs of results) {
      for (const msg of msgs) {
        const mt = msg.messageType || "";
        if (!mt.includes("CALL")) continue;
        const msgDate = new Date(msg.dateAdded).getTime();
        if (msgDate < startTs || msgDate > endTs) continue;

        const isInbound = msg.direction === "inbound" || mt === "TYPE_IVR_CALL";
        const duration = msg.meta?.call?.duration || 0;
        const status = msg.meta?.call?.status || msg.status || "";
        const connected = status === "completed" && duration >= 20;

        if (isInbound) totalInbound++;
        else dials++;

        if (connected) {
          connects++;
          totalDuration += duration;
        } else {
          missedCalls++;
        }
      }
    }
  }

  return { dials, totalInbound, missedCalls, connects, totalDuration };
}

// Fetch seller contacts created in date range
async function fetchSellerContacts(start: Date, end: Date) {
  let leads = 0; // sellers with address
  let prospects = 0; // all sellers
  let startAfterId = "";
  let startAfter = 0;

  for (let page = 0; page < 10; page++) {
    let url = `${BASE}/contacts/?locationId=${LOCATION_ID()}&limit=100`;
    if (startAfterId) {
      url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;
    }

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    const contacts = data.contacts || [];
    if (contacts.length === 0) break;

    for (const c of contacts) {
      const created = new Date(c.dateAdded);
      if (created < start || created > new Date(end.getTime() + 86400000)) continue;

      const cfs: Record<string, string> = {};
      for (const cf of c.customFields || []) {
        cfs[cf.id] = cf.value;
      }
      const contactType = cfs[CONTACT_TYPE_FIELD] || "";
      if (contactType === "Seller") {
        prospects++;
        if (c.address1 && c.address1.trim()) {
          leads++;
        }
      }
    }

    const meta = data.meta || {};
    if (!meta.nextPageUrl) break;
    startAfterId = meta.startAfterId || "";
    startAfter = meta.startAfter || 0;

    // If we've gone past our date range, stop
    const lastCreated = new Date(contacts[contacts.length - 1].dateAdded);
    if (lastCreated < start) break;
  }

  return { leads, prospects };
}

// Fetch calendar events for a date range
async function fetchAppointments(calendarId: string, start: Date, end: Date) {
  const url = `${BASE}/calendars/events?locationId=${LOCATION_ID()}&calendarId=${calendarId}&startTime=${start.getTime()}&endTime=${end.getTime() + 86400000}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) return { booked: 0, cancelled: 0, completed: 0, rescheduled: 0 };

  const data = await res.json();
  const events = data.events || [];

  let booked = 0, cancelled = 0, completed = 0, rescheduled = 0;
  for (const e of events) {
    if (e.deleted) continue;
    booked++;

    const title = (e.title || "").toLowerCase();
    const status = e.appointmentStatus || "";

    if (status === "cancelled" || title.startsWith("c-") || title.includes("cancel")) {
      cancelled++;
    } else if (status === "noshow" || status === "no_show") {
      // not completed
    } else {
      // Check if event is in the past (completed)
      const eventEnd = new Date(e.endTime);
      if (eventEnd < new Date()) {
        completed++;
      }
    }

    if (title.includes("reschedul")) {
      rescheduled++;
    }
  }

  return { booked, cancelled, completed, rescheduled };
}

// Fetch opportunities by pipeline and stage, filtered by lastStageChangeAt
async function fetchOpportunitiesByStage(
  pipelineId: string,
  stageId: string,
  start: Date,
  end: Date
) {
  const results: { count: number; totalAbPrice: number; totalBcPrice: number; totalGrossProfit: number } = {
    count: 0, totalAbPrice: 0, totalBcPrice: 0, totalGrossProfit: 0,
  };

  let hasMore = true;
  let startAfterId = "";

  while (hasMore) {
    let url = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pipelineId}&pipeline_stage_id=${stageId}&limit=100`;
    if (startAfterId) {
      url += `&startAfterId=${startAfterId}`;
    }

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    const opps = data.opportunities || [];
    if (opps.length === 0) break;

    for (const o of opps) {
      const changed = new Date(o.lastStageChangeAt);
      if (changed >= start && changed <= new Date(end.getTime() + 86400000)) {
        results.count++;

        // Get full opportunity detail for custom fields
        const detailRes = await fetch(`${BASE}/opportunities/${o.id}`, { headers: getHeaders() });
        if (detailRes.ok) {
          const detail = await detailRes.json();
          const opp = detail.opportunity || detail;
          for (const cf of opp.customFields || []) {
            const val = parseFloat(cf.fieldValue || cf.fieldValueString || "0") || 0;
            if (cf.id === OPP_FIELDS.abPrice) results.totalAbPrice += val;
            if (cf.id === OPP_FIELDS.bcPrice) results.totalBcPrice += val;
            if (cf.id === OPP_FIELDS.grossProfit) results.totalGrossProfit += val;
          }
        }
      }
    }

    const meta = data.meta || {};
    if (!meta.nextPageUrl && opps.length < 100) {
      hasMore = false;
    } else {
      startAfterId = opps[opps.length - 1]?.id || "";
      if (!startAfterId) hasMore = false;
    }
  }

  return results;
}

async function buildWeekData(start: Date, end: Date): Promise<WeekData> {
  const [
    calls,
    contacts,
    inPersonAppts,
    virtualAppts,
    mikeOffers,
    joshOffers,
    abDeals,
    settled,
  ] = await Promise.all([
    fetchCallsForRange(start, end),
    fetchSellerContacts(start, end),
    fetchAppointments(MIKE_CALENDAR, start, end),
    fetchAppointments(JOSH_CALENDAR, start, end),
    fetchOpportunitiesByStage(MIKE_PIPELINE, STAGES.mikeOfferMade, start, end),
    fetchOpportunitiesByStage(JOSH_PIPELINE, STAGES.joshOffered, start, end),
    fetchOpportunitiesByStage(DEALS_PIPELINE, STAGES.underContract, start, end),
    fetchOpportunitiesByStage(TC_PIPELINE, STAGES.tcClosedDispo, start, end),
  ]);

  const totalCalls = calls.dials + calls.totalInbound;
  const totalBooked = inPersonAppts.booked + virtualAppts.booked;

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    dials: calls.dials,
    totalInbound: calls.totalInbound,
    pickUpRate: totalCalls > 0 ? Math.round((calls.connects / totalCalls) * 10000) / 100 : 0,
    missedCalls: calls.missedCalls,
    connects: calls.connects,
    avgCallDuration: calls.connects > 0 ? Math.round(calls.totalDuration / calls.connects) : 0,
    connectRate: totalCalls > 0 ? Math.round((calls.connects / totalCalls) * 10000) / 100 : 0,
    leads: contacts.leads,
    prospects: contacts.prospects,
    bookingPct: contacts.prospects > 0 ? Math.round((totalBooked / contacts.prospects) * 10000) / 100 : 0,
    inPersonBooked: inPersonAppts.booked,
    virtualBooked: virtualAppts.booked,
    cancelledInPerson: inPersonAppts.cancelled,
    cancelledVirtual: virtualAppts.cancelled,
    rescheduled: inPersonAppts.rescheduled + virtualAppts.rescheduled,
    inPersonCompleted: inPersonAppts.completed,
    virtualCompleted: virtualAppts.completed,
    showRateInPerson: inPersonAppts.booked > 0
      ? Math.round((inPersonAppts.completed / inPersonAppts.booked) * 10000) / 100 : 0,
    showRateVirtual: virtualAppts.booked > 0
      ? Math.round((virtualAppts.completed / virtualAppts.booked) * 10000) / 100 : 0,
    inPersonOffers: mikeOffers.count,
    virtualOffers: joshOffers.count,
    abSigned: abDeals.count,
    bcSigned: 0, // TODO: could track B-C specific stage
    settled: settled.count,
    grossProfit: settled.totalGrossProfit || (settled.totalBcPrice - settled.totalAbPrice),
    netProfit: 0, // calculated from gross minus expenses
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get("week"); // optional: specific week "2026-01-05"

  try {
    if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
      return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
    }

    if (weekParam) {
      // Single week
      const start = new Date(weekParam + "T00:00:00Z");
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const data = await buildWeekData(start, end);
      return NextResponse.json({ weeks: [data], lastUpdated: new Date().toISOString() });
    }

    // All weeks in 2026
    const weeks = getWeeks2026();

    // Process weeks in parallel batches of 2 to avoid rate limits
    const allWeekData: WeekData[] = [];
    const batchSize = 2;
    for (let i = 0; i < weeks.length; i += batchSize) {
      const batch = weeks.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((w) => buildWeekData(w.start, w.end))
      );
      allWeekData.push(...results);
    }

    return NextResponse.json({
      weeks: allWeekData,
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
