import { fetchAllCalls2026 } from "@/app/lib/ghl-calls";

export const FRESH_KEY = "scorecard_cache_v3";

// Per-week historical lock. Each entry stores ONE week's metrics + the
// timestamp it was frozen. Cron only re-computes current + last week;
// every other week stays locked unless Ashley manually unfreezes via
// `?week=YYYY-MM-DD` or full rebuild via `?all=true`.
export const WEEK_KEY_PREFIX = "scorecard_week_v1_";
export function weekKey(monday: string): string {
  return `${WEEK_KEY_PREFIX}${monday}`;
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
  mikeYardLine: "64d1fa71-6952-41cd-be5e-1536715b6d87", // Mike pipeline "1 YD LINE" — seller agreement signed
  joshOffered: "d6a230e1-fc7d-4881-b238-70b83230dfc4",
  joshYardLine: "f02c3be3-680d-46f7-b36f-766a8f72f39b", // Josh pipeline "1 YD LINE"
  joshLtfu: "80557eb7-6144-4ed8-9453-2c2488725294", // Josh pipeline "LTFU"
  joshWon: "0c4afc64-8163-4723-9f78-d4a0d7e1d037", // Josh pipeline "WON!"
  tcBcAssigned: "79163384-97f7-4b12-a3ca-a15c092f04f4",
  tcClosedDispo: "8464b838-cb2d-497a-89f6-07c4025ae17f",
  dealsClosedDeal: "245bc5b3-e2ac-4886-8928-907560ec3f15",
};

// Authoritative A-B signed signal: the opportunity custom field "A-B Date Signed"
// (id g4hucgb9oTwMYC9AZmF4, DATE). Set by Ashley when the A-B contract is signed.
// Read from /opportunities/search response as customFields[id=...].fieldValueDate (ms epoch).
const AB_DATE_SIGNED_FIELD = "g4hucgb9oTwMYC9AZmF4";
const BC_DATE_SIGNED_FIELD = "Lbe97UOqLlo25vZMSt6X";

const CONTACT_TYPE_FIELD = "IfkLFRqVzW9XrCkXvPUQ";
const MARKETING_CAMPAIGN_FIELD = "4fOhwf1m5nhK1c9vI6SJ";

const JAN1_2026 = new Date("2026-01-01T00:00:00Z").getTime();

// ============ CLOSER USER ID DISCOVERY ============
// Module-level cache so we only hit /users/search once per cold start.
let mikeUserId: string | null = null;
let joshUserId: string | null = null;
let userIdsDiscovered = false;

async function discoverCloserUserIds(): Promise<void> {
  if (userIdsDiscovered) return;
  userIdsDiscovered = true;
  try {
    // /users/search requires companyId. /users/?locationId returns the seats
    // attached to a location and is what we want here.
    const url = `${BASE}/users/?locationId=${LOCATION_ID()}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) {
      console.warn(
        `[Scorecard] /users/?locationId failed (${res.status}); falling back to pipeline-membership for closer attribution`
      );
      return;
    }
    const data = await res.json();
    const users = data.users || [];
    console.log(
      `[Scorecard] /users/?locationId returned ${users.length} users; sample:`,
      JSON.stringify(
        users.slice(0, 5).map((u: { id: string; firstName?: string; lastName?: string; name?: string; email?: string }) => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
        }))
      )
    );

    // Match by email first (most stable), then by name. Mike Aubele's first
    // name is "Mike"; Josh's is actually "Joshua" — match by prefix.
    let mikeFallback: string | null = null;
    for (const u of users) {
      const fn = (u.firstName || "").trim();
      const ln = (u.lastName || "").trim();
      const email = (u.email || "").toLowerCase();

      if (!mikeUserId) {
        if (email === "mike@theimpacthometeam.com") {
          mikeUserId = u.id;
        } else if (
          (fn === "Mike" || fn === "Michael") &&
          ln.toLowerCase().startsWith("aubele")
        ) {
          mikeUserId = u.id;
        } else if (!mikeFallback && (fn === "Mike" || fn === "Michael")) {
          mikeFallback = u.id;
        }
      }
      if (!joshUserId) {
        if (
          email === "joshua@theimpacthometeam.com" ||
          email === "josh@theimpacthometeam.com"
        ) {
          joshUserId = u.id;
        } else if (fn === "Josh" || fn === "Joshua") {
          joshUserId = u.id;
        }
      }
    }
    if (!mikeUserId && mikeFallback) mikeUserId = mikeFallback;

    console.log(
      "[Scorecard] Discovered user IDs — Mike:",
      mikeUserId,
      "Josh:",
      joshUserId
    );
    if (!mikeUserId)
      console.warn(
        "[Scorecard] WARNING: Could not find Mike's user ID; falling back to pipeline-membership for Mike attribution"
      );
    if (!joshUserId)
      console.warn(
        "[Scorecard] WARNING: Could not find Josh's user ID; falling back to pipeline-membership for Josh attribution"
      );
  } catch (e) {
    console.warn("[Scorecard] Closer user-ID discovery threw:", e);
  }
}

// ============ STAGE DISCOVERY (logging only) ============
async function logClosingLikeStages(): Promise<void> {
  try {
    const res = await fetch(
      `${BASE}/opportunities/pipelines?locationId=${LOCATION_ID()}`,
      { headers: getHeaders() }
    );
    if (!res.ok) {
      console.warn(`[Scorecard] /opportunities/pipelines failed (${res.status})`);
      return;
    }
    const data = await res.json();
    const pipelines = data.pipelines || [];
    const known = new Set<string>([
      STAGES.dealsClosedDeal,
      STAGES.tcClosedDispo,
    ]);
    const closingLike: { pipeline: string; stage: string; id: string; known: boolean }[] = [];
    const re = /closed|won|funded|settled/i;
    for (const p of pipelines) {
      for (const s of p.stages || []) {
        if (re.test(s.name || "")) {
          closingLike.push({
            pipeline: p.name,
            stage: s.name,
            id: s.id,
            known: known.has(s.id),
          });
        }
      }
    }
    console.log(
      "[Scorecard] Closing-like stages discovered:",
      JSON.stringify(closingLike, null, 2)
    );
  } catch (e) {
    console.warn("[Scorecard] Stage discovery threw:", e);
  }
}

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

// ============ TYPES ============

interface SourceBreakdown {
  [source: string]: number;
}

// Per-month split for cross-month boundary weeks (e.g. 3/30–4/5 with a deal
// closed 4/3). Keyed by month-name (lowercase) → metrics.
//
// Only the metrics that have authoritative per-event dates are split:
//   • settled / grossProfit  (closingDate custom field on the opp)
//   • abSigned               (lastStageChangeAt on the opp)
//   • inPersonOffers / virtualOffers (lastStageChangeAt on the opp)
//
// Call/lead/appt counts stay bucketed by week-start since their per-day
// breakdown isn't surfaced here. The page reads `monthSplits` when present
// and falls back to the week-level aggregate otherwise.
export interface MonthSplit {
  settled: number;
  grossProfit: number;
  abSigned: number;
  inPersonOffers: number;
  virtualOffers: number;
}
export type MonthSplits = Record<string, MonthSplit>;

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
  leadsBySource: SourceBreakdown;
  apptsBySource: SourceBreakdown;
  abBySource: SourceBreakdown;
  settledBySource: SourceBreakdown;
  // Per-source gross profit for settled deals (sum of monetaryValue from each
  // settled opportunity, keyed by the same source string used in
  // `settledBySource`). Marketing builder reads this so its per-channel
  // grossProfit numbers DERIVE from scorecard truth instead of being
  // computed independently. Source-only attribution — never tiebreaker via
  // campaign field. Single source of truth for financial decisions.
  grossProfitBySource: SourceBreakdown;
  mikeAppts: number;
  mikeOffers: number;
  mikeSigned: number;
  mikeSettled: number;
  joshAppts: number;
  joshOffers: number;
  joshSigned: number;
  joshSettled: number;
  // Only present when the week crosses a month boundary (e.g. 3/30–4/5).
  // Keyed by lowercase month-name; metrics are split by each event's
  // actual date. Page consumes this in monthlySummaries.
  monthSplits?: MonthSplits;
}

export interface ScorecardData {
  weeks: WeekData[];
  lastUpdated: string;
}

export interface ScorecardCachePayload {
  data: ScorecardData;
  refreshedAt: string;
}

// One-week per-week store entry — what gets written to `scorecard_week_v1_{monday}`.
export interface WeekCacheEntry {
  data: WeekData;
  frozenAt: string;
}

// Compute the (current + last completed) Monday keys we want to refresh on
// the weekly cron. Returns the list of Monday-ISO keys that the default cron
// invocation should rebuild — every other week stays locked.
export function getCronTargetWeekKeys(now: Date = new Date()): string[] {
  // Find this week's Monday in UTC (matches getWeeks2026 which uses UTC Mondays).
  const t = new Date(now);
  t.setUTCHours(0, 0, 0, 0);
  // getUTCDay: 0 Sun … 1 Mon … 6 Sat
  const day = t.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  t.setUTCDate(t.getUTCDate() + offsetToMonday);
  const thisMonday = t.toISOString().slice(0, 10);
  const lastMonday = new Date(t);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
  return [lastMonday.toISOString().slice(0, 10), thisMonday];
}

// ============ DATA FETCHERS ============

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

    const lastCreated = new Date(contacts[contacts.length - 1].dateAdded).getTime();
    if (lastCreated < JAN1_2026) break;
  }

  return sellers;
}

interface ApptRecord {
  date: number;
  calendarId: string;
  contactId: string;
  closer: string;
  cancelled: boolean;
  completed: boolean;
  rescheduled: boolean;
  source: string;
  title: string;
}

// Module-level: latest appointment date per contact, per closer's calendar.
// Populated inside fetchCalendarEvents. Used by resolveCloser as the
// authoritative closer signal when assignedTo is Emma/unassigned.
const mikeCalendarLatest = new Map<string, number>();
const joshCalendarLatest = new Map<string, number>();

const contactSourceCache = new Map<string, string>();

async function getContactSource(contactId: string): Promise<string> {
  if (!contactId) return "Other";
  if (contactSourceCache.has(contactId)) return contactSourceCache.get(contactId)!;
  const res = await fetch(`${BASE}/contacts/${contactId}`, { headers: getHeaders() });
  if (!res.ok) {
    contactSourceCache.set(contactId, "Other");
    return "Other";
  }
  const data = await res.json();
  const c = data.contact || {};
  const cfs: Record<string, string> = {};
  for (const cf of c.customFields || []) cfs[cf.id] = cf.value;
  const campaign = cfs[MARKETING_CAMPAIGN_FIELD] || "";
  const src = c.source || campaign || "Other";
  contactSourceCache.set(contactId, src);
  return src;
}

async function fetchCalendarEvents(calId: string, closer: string): Promise<ApptRecord[]> {
  const appts: ApptRecord[] = [];
  const now = Date.now();
  const url = `${BASE}/calendars/events?locationId=${LOCATION_ID()}&calendarId=${calId}&startTime=${JAN1_2026}&endTime=${now}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    console.error(`Calendar fetch failed for ${closer}: ${res.status}`);
    return [];
  }
  const data = await res.json();
  const events = data.events || [];
  console.log(`Scorecard: ${closer} calendar has ${events.length} events`);

  const batchSize = 10;
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);
    const sources = await Promise.all(
      batch.map((e: { contactId?: string }) => getContactSource(e.contactId || ""))
    );
    batch.forEach(
      (
        e: {
          deleted?: boolean;
          title?: string;
          appointmentStatus?: string;
          startTime: string;
          endTime: string;
          contactId?: string;
        },
        idx: number
      ) => {
        if (e.deleted) return;
        const titleLower = (e.title || "").toLowerCase();
        const status = e.appointmentStatus || "";
        const cancelled =
          status === "cancelled" ||
          titleLower.startsWith("c-") ||
          titleLower.includes("cancel");
        const endTime = new Date(e.endTime).getTime();
        const startTime = new Date(e.startTime).getTime();
        const cid = e.contactId || "";

        // Track latest non-cancelled appointment per contact per closer's calendar.
        // Used downstream to attribute TC pipeline opps to a closer when GHL
        // assignedTo is Emma (TC coordinator) or empty.
        if (cid && !cancelled) {
          const map = closer === "Mike" ? mikeCalendarLatest : joshCalendarLatest;
          const existing = map.get(cid) || 0;
          if (startTime > existing) map.set(cid, startTime);
        }

        appts.push({
          date: startTime,
          calendarId: calId,
          contactId: cid,
          closer,
          cancelled,
          completed: !cancelled && endTime < now,
          rescheduled: titleLower.includes("reschedul"),
          source: sources[idx],
          title: e.title || "",
        });
      }
    );
  }
  return appts;
}

export async function fetchAllAppointments2026(): Promise<ApptRecord[]> {
  const [mikeAppts, joshAppts] = await Promise.all([
    fetchCalendarEvents(MIKE_CALENDAR, "Mike"),
    fetchCalendarEvents(JOSH_CALENDAR, "Josh"),
  ]);
  console.log(
    `Scorecard: total appts - Mike: ${mikeAppts.length}, Josh: ${joshAppts.length}`
  );
  return [...mikeAppts, ...joshAppts];
}

interface OppRecord {
  date: number;
  category: "offer_mike" | "offer_josh" | "ab_signed" | "bc_signed" | "settled";
  closer: string;
  name: string;
  source: string;
  monetaryValue: number;
}

interface OppSearchResult {
  id: string;
  name: string;
  source: string;
  contactId: string;
  assignedTo: string;
  pipelineStageId: string;
  lastStageChangeAt: string;
  createdAt: string;
  monetaryValue: number;
}

async function fetchOppsByStage(
  pipelineId: string,
  stageId: string
): Promise<OppSearchResult[]> {
  const results: OppSearchResult[] = [];
  let url = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pipelineId}&pipeline_stage_id=${stageId}&limit=100`;
  for (let page = 0; page < 25; page++) {
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    for (const o of data.opportunities || []) {
      results.push({
        id: o.id,
        name: o.name || "",
        source: o.source || "",
        contactId: o.contactId || "",
        assignedTo: o.assignedTo || "",
        pipelineStageId: o.pipelineStageId || "",
        lastStageChangeAt: o.lastStageChangeAt,
        createdAt: o.createdAt,
        monetaryValue: o.monetaryValue || 0,
      });
    }
    const next = data?.meta?.nextPageUrl;
    if (!next) break;
    url = next;
  }
  return results;
}

// Fetch every opp in a pipeline (any stage). Used to build a contact-membership
// set for closer attribution (Mike pipeline → Mike, Josh pipeline → Josh).
async function fetchAllOppsInPipeline(
  pipelineId: string
): Promise<OppSearchResult[]> {
  const results: OppSearchResult[] = [];
  let url = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pipelineId}&limit=100`;
  for (let page = 0; page < 25; page++) {
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    for (const o of data.opportunities || []) {
      results.push({
        id: o.id,
        name: o.name || "",
        source: o.source || "",
        contactId: o.contactId || "",
        assignedTo: o.assignedTo || "",
        pipelineStageId: o.pipelineStageId || "",
        lastStageChangeAt: o.lastStageChangeAt,
        createdAt: o.createdAt,
        monetaryValue: o.monetaryValue || 0,
      });
    }
    const next = data?.meta?.nextPageUrl;
    if (!next) break;
    url = next;
  }
  return results;
}

export async function fetchAllOpportunities2026(): Promise<OppRecord[]> {
  const opps: OppRecord[] = [];

  // Discover closer user IDs + log any closing-like stages we don't already track.
  await Promise.all([discoverCloserUserIds(), logClosingLikeStages()]);

  // bcAssigned removed — B-C signed now sourced from "B-C Date Signed" custom field
  const [
    mikeOffers,
    joshOffers,
    closedDealsA,
    closedDealsB,
    mikePipelineAll,
    joshPipelineAll,
  ] = await Promise.all([
    fetchOppsByStage(MIKE_PIPELINE, STAGES.mikeOfferMade),
    fetchOppsByStage(JOSH_PIPELINE, STAGES.joshOffered),
    fetchOppsByStage(DEALS_PIPELINE, STAGES.dealsClosedDeal),
    fetchOppsByStage(TC_PIPELINE, STAGES.tcClosedDispo),
    fetchAllOppsInPipeline(MIKE_PIPELINE),
    fetchAllOppsInPipeline(JOSH_PIPELINE),
  ]);

  console.log(
    `[Scorecard] Pipeline membership sets — Mike pipeline opps=${mikePipelineAll.length}, Josh pipeline opps=${joshPipelineAll.length}`
  );

  // mikeContactIds / joshContactIds removed — resolveCloser no longer uses
  // pipeline-membership fallback; opp.assignedTo is the only signal.

  // Merge closings, dedupe by opp id (a deal could in theory live in both stages).
  const closedById = new Map<string, OppSearchResult>();
  for (const o of [...closedDealsA, ...closedDealsB]) {
    if (o.id && !closedById.has(o.id)) closedById.set(o.id, o);
  }
  const closedDeals = Array.from(closedById.values());
  console.log(
    `[Scorecard] Closings: dealsClosedDeal=${closedDealsA.length}, tcClosedDispo=${closedDealsB.length}, merged=${closedDeals.length}`
  );

  // Resolve closer for a TC/deals opp.
  // Priority: assignedTo on the opp itself (rare but authoritative) →
  // pipeline membership (the contact has a Mike-pipeline or Josh-pipeline opp) →
  // historical mikeOffers stage membership (final fallback).
  const resolveCloser = (o: {
    contactId?: string;
    assignedTo?: string;
  }): "Mike" | "Josh" => {
    const assignedTo = o.assignedTo || "";
    // The ONLY reliable Josh signal: opp.assignedTo is explicitly Josh's user
    // ID. Per Ashley 2026-05-07: calendar fallback over-attributed to Josh
    // (e.g. Josh did a follow-up call on a Mike deal → Josh's calendar got
    // a more-recent entry → resolveCloser flipped the deal). Calendar isn't
    // reliable enough to attribute closer when assignedTo is Emma.
    if (joshUserId && assignedTo === joshUserId) return "Josh";
    if (mikeUserId && assignedTo === mikeUserId) return "Mike";
    // Default to Mike — he's the primary closer; Josh is the exception.
    return "Mike";
  };

  for (const o of mikeOffers) {
    const d = new Date(o.lastStageChangeAt).getTime();
    const src = o.contactId ? await getContactSource(o.contactId) : o.source;
    if (d >= JAN1_2026)
      opps.push({
        date: d,
        category: "offer_mike",
        closer: "Mike",
        name: o.name,
        source: src,
        monetaryValue: 0,
      });
  }
  for (const o of joshOffers) {
    const d = new Date(o.lastStageChangeAt).getTime();
    const src = o.contactId ? await getContactSource(o.contactId) : o.source;
    if (d >= JAN1_2026)
      opps.push({
        date: d,
        category: "offer_josh",
        closer: "Josh",
        name: o.name,
        source: src,
        monetaryValue: 0,
      });
  }

  // A-B signed = opportunity custom field "A-B Date Signed" (g4hucgb9oTwMYC9AZmF4)
  // is set with a date >= JAN1_2026. Deduped by opp id. Spans every pipeline an
  // A-B signed deal could live in (Mike, Josh, TC, Deals). The custom field is
  // authoritative — pipeline state alone misses deals that already moved to
  // Closed Deal in pipeline 7. See reference_ghl_custom_fields.md.
  type CfEntry = { id?: string; fieldValueDate?: number; fieldValue?: string };
  type OppLite = {
    id?: string;
    name?: string;
    contactId?: string;
    assignedTo?: string;
    source?: string;
    monetaryValue?: number;
    customFields?: CfEntry[];
  };

  function abSignedDateMs(o: OppLite): number | null {
    const cfs = o?.customFields || [];
    const entry = cfs.find((c) => c?.id === AB_DATE_SIGNED_FIELD);
    if (!entry) return null;
    // /opportunities/search uses fieldValueDate (ms epoch); /opportunities/{id} uses fieldValue (ISO string)
    if (typeof entry.fieldValueDate === "number") return entry.fieldValueDate;
    if (entry.fieldValue) {
      const t = new Date(entry.fieldValue).getTime();
      return isNaN(t) ? null : t;
    }
    return null;
  }

  const abSignedSeenOppId = new Set<string>();
  const tagAbSigned = async (
    o: OppLite,
    closerHint?: "Mike" | "Josh",
  ) => {
    if (!o?.id || abSignedSeenOppId.has(o.id)) return;
    const signedMs = abSignedDateMs(o);
    if (signedMs === null || signedMs < JAN1_2026) return;
    abSignedSeenOppId.add(o.id);
    const src = o.contactId ? await getContactSource(o.contactId) : o.source || "";
    const closer =
      closerHint ||
      resolveCloser({
        contactId: o.contactId,
        assignedTo: o.assignedTo || "",
      });
    opps.push({
      date: signedMs,
      category: "ab_signed",
      closer,
      name: o.name || "",
      source: src,
      monetaryValue: o.monetaryValue || 0,
    });
  };

  // Sources: Mike, Josh, TC, Deals — every pipeline a signed-A-B opp may live in.
  for (const o of mikePipelineAll) await tagAbSigned(o, "Mike");
  for (const o of joshPipelineAll) await tagAbSigned(o, "Josh");

  for (const pipelineId of [TC_PIPELINE, DEALS_PIPELINE]) {
    let nextUrl: string | null = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pipelineId}&limit=100`;
    for (let page = 0; page < 25 && nextUrl; page++) {
      const r: Response = await fetch(nextUrl, { headers: getHeaders() });
      if (!r.ok) break;
      const data = await r.json();
      for (const o of data.opportunities || []) await tagAbSigned(o);
      nextUrl = data?.meta?.nextPageUrl || null;
    }
  }

  // B-C signed = opportunity custom field "B-C Date Signed" (Lbe97UOqLlo25vZMSt6X)
  // ≥ JAN1_2026. Same authoritative custom-field pattern as A-B above. Scans
  // every pipeline a B-C signed opp could live in. Deduped by opp id.
  function bcSignedDateMs(o: OppLite): number | null {
    const cfs = o?.customFields || [];
    const entry = cfs.find((c) => c?.id === BC_DATE_SIGNED_FIELD);
    if (!entry) return null;
    if (typeof entry.fieldValueDate === "number") return entry.fieldValueDate;
    if (entry.fieldValue) {
      const t = new Date(entry.fieldValue).getTime();
      return isNaN(t) ? null : t;
    }
    return null;
  }

  const bcSignedSeenOppId = new Set<string>();
  const tagBcSigned = async (
    o: OppLite,
    closerHint?: "Mike" | "Josh",
  ) => {
    if (!o?.id || bcSignedSeenOppId.has(o.id)) return;
    const signedMs = bcSignedDateMs(o);
    if (signedMs === null || signedMs < JAN1_2026) return;
    bcSignedSeenOppId.add(o.id);
    const src = o.contactId ? await getContactSource(o.contactId) : o.source || "";
    const closer =
      closerHint ||
      resolveCloser({
        contactId: o.contactId,
        assignedTo: o.assignedTo || "",
      });
    opps.push({
      date: signedMs,
      category: "bc_signed",
      closer,
      name: o.name || "",
      source: src,
      monetaryValue: o.monetaryValue || 0,
    });
  };

  for (const o of mikePipelineAll) await tagBcSigned(o, "Mike");
  for (const o of joshPipelineAll) await tagBcSigned(o, "Josh");

  for (const pipelineId of [TC_PIPELINE, DEALS_PIPELINE]) {
    let nextUrl: string | null = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pipelineId}&limit=100`;
    for (let page = 0; page < 25 && nextUrl; page++) {
      const r: Response = await fetch(nextUrl, { headers: getHeaders() });
      if (!r.ok) break;
      const data = await r.json();
      for (const o of data.opportunities || []) await tagBcSigned(o);
      nextUrl = data?.meta?.nextPageUrl || null;
    }
  }

  // Settled (merge of dealsClosedDeal + tcClosedDispo, deduped above)
  // Prefilter by lastStageChangeAt to avoid fetching detail on hundreds of
  // pre-2026 closings — a 2026 closing date can't predate the stage change
  // by more than ~2 months. Cutoff: 2025-11-01.
  const CLOSING_DATE_FIELD = "bbDP5pNJ96IMth9bQfh8";
  const STAGE_CHANGE_CUTOFF = new Date("2025-11-01T00:00:00Z").getTime();
  const candidates = closedDeals.filter((o) => {
    const t = o.lastStageChangeAt ? new Date(o.lastStageChangeAt).getTime() : 0;
    return !t || t >= STAGE_CHANGE_CUTOFF;
  });
  console.log(
    `[Scorecard] Settled prefilter: ${closedDeals.length} closed → ${candidates.length} candidates after stage-change cutoff`
  );

  // Batch detail fetches in parallel (10 at a time).
  const BATCH = 10;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const details = await Promise.all(
      slice.map(async (o) => {
        try {
          const r = await fetch(`${BASE}/opportunities/${o.id}`, {
            headers: getHeaders(),
          });
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
      })
    );
    for (let j = 0; j < slice.length; j++) {
      const o = slice[j];
      const detail = details[j];
      if (!detail) continue;
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
      const closer = resolveCloser({
        contactId: o.contactId,
        assignedTo: opp.assignedTo || o.assignedTo || "",
      });
      opps.push({
        date: d,
        category: "settled",
        closer,
        name: o.name,
        source: src,
        monetaryValue: opp.monetaryValue || 0,
      });
    }
  }

  return opps;
}

// ============ BUILD ============

export async function buildFreshScorecard(): Promise<ScorecardData> {
  const weeks = getWeeks2026();

  // Reset request-scoped contact source cache
  contactSourceCache.clear();

  console.log("Scorecard: fetching fresh GHL data...");
  // Reset calendar→closer maps each run (module-level, persists across requests otherwise)
  mikeCalendarLatest.clear();
  joshCalendarLatest.clear();
  // Calendars MUST resolve before opportunities so resolveCloser can use them
  // for TC pipeline attribution (when GHL assignedTo is Emma/empty).
  const [allCalls, allSellers, allAppts] = await Promise.all([
    fetchAllCalls2026(),
    fetchAllSellerContacts2026(),
    fetchAllAppointments2026(),
  ]);
  const allOpps = await fetchAllOpportunities2026();
  console.log(
    `Scorecard: ${allCalls.length} calls, ${allSellers.length} sellers, ${allAppts.length} appts, ${allOpps.length} opps`
  );

  const weekData: WeekData[] = weeks.map((w) => {
    const weekCalls = allCalls.filter((c) => {
      const wk = findWeekKey(new Date(c.date), weeks);
      return wk === w.key;
    });
    const dials = weekCalls.filter((c) => c.direction === "outbound").length;
    const totalInbound = weekCalls.filter((c) => c.direction === "inbound").length;
    const totalCallCount = dials + totalInbound;
    const connects = weekCalls.filter((c) => c.connected).length;
    // Missed = inbound calls we didn't pick up (unanswered outbound dials are NOT misses).
    const missedCalls = weekCalls.filter(
      (c) => c.direction === "inbound" && !c.connected
    ).length;
    const connectedCalls = weekCalls.filter((c) => c.connected);
    const totalDuration = connectedCalls.reduce((a, c) => a + c.duration, 0);
    const avgCallDuration =
      connectedCalls.length > 0
        ? Math.round(totalDuration / connectedCalls.length)
        : 0;

    const weekSellers = allSellers.filter((s) => {
      const wk = findWeekKey(new Date(s.dateAdded), weeks);
      return wk === w.key;
    });
    const leads = weekSellers.filter((s) => s.hasAddress).length;
    const prospects = weekSellers.length;

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

    const leadsBySource: SourceBreakdown = {};
    weekSellers
      .filter((s) => s.hasAddress)
      .forEach((s) => {
        const src = s.source || "Unknown";
        leadsBySource[src] = (leadsBySource[src] || 0) + 1;
      });

    const apptsBySource: SourceBreakdown = {};
    weekAppts
      .filter((a) => !a.cancelled)
      .forEach((a) => {
        const src = a.source || "Other";
        apptsBySource[src] = (apptsBySource[src] || 0) + 1;
      });

    const abBySource: SourceBreakdown = {};
    weekOpps
      .filter((o) => o.category === "ab_signed")
      .forEach((o) => {
        const src = o.source || "Other";
        abBySource[src] = (abBySource[src] || 0) + 1;
      });

    const settledBySource: SourceBreakdown = {};
    const grossProfitBySource: SourceBreakdown = {};
    settledOpps.forEach((o) => {
      const src = o.source || "Other";
      settledBySource[src] = (settledBySource[src] || 0) + 1;
      grossProfitBySource[src] = (grossProfitBySource[src] || 0) + (o.monetaryValue || 0);
    });

    const mikeAppts = weekAppts.filter((a) => a.closer === "Mike" && !a.cancelled).length;
    const joshAppts = weekAppts.filter((a) => a.closer === "Josh" && !a.cancelled).length;

    // Cross-month boundary detection — when a week's start month differs from
    // its end month, partition the date-anchored metrics (settled / grossProfit /
    // abSigned / offers) by each event's actual month. Page uses this in
    // monthlySummaries so e.g. a deal closed 4/3 in week 3/30–4/5 lands in
    // April, not March.
    const startMonthIdx = w.start.getUTCMonth();
    const endMonthIdx = w.end.getUTCMonth();
    let monthSplits: MonthSplits | undefined;
    if (startMonthIdx !== endMonthIdx) {
      const splits: MonthSplits = {};
      const ensure = (m: string): MonthSplit => {
        if (!splits[m]) {
          splits[m] = {
            settled: 0,
            grossProfit: 0,
            abSigned: 0,
            inPersonOffers: 0,
            virtualOffers: 0,
          };
        }
        return splits[m];
      };
      const monthNameOf = (ms: number): string =>
        new Date(ms).toLocaleString("en-US", {
          month: "long",
          timeZone: "UTC",
        }).toLowerCase();
      for (const o of weekOpps) {
        const mName = monthNameOf(o.date);
        const bucket = ensure(mName);
        if (o.category === "settled") {
          bucket.settled += 1;
          bucket.grossProfit += o.monetaryValue || 0;
        } else if (o.category === "ab_signed") {
          bucket.abSigned += 1;
        } else if (o.category === "offer_mike") {
          bucket.inPersonOffers += 1;
        } else if (o.category === "offer_josh") {
          bucket.virtualOffers += 1;
        }
      }
      monthSplits = splits;
    }

    return {
      startDate: w.start.toISOString().slice(0, 10),
      endDate: w.end.toISOString().slice(0, 10),
      dials,
      totalInbound,
      pickUpRate:
        totalCallCount > 0
          ? Math.round((connects / totalCallCount) * 10000) / 100
          : 0,
      missedCalls,
      connects,
      avgCallDuration,
      connectRate:
        totalCallCount > 0
          ? Math.round((connects / totalCallCount) * 10000) / 100
          : 0,
      leads,
      prospects,
      bookingPct:
        leads > 0 ? Math.round((totalBooked / leads) * 10000) / 100 : 0,
      inPersonBooked,
      virtualBooked,
      cancelledInPerson,
      cancelledVirtual,
      rescheduled,
      inPersonCompleted,
      virtualCompleted,
      showRateInPerson:
        inPersonBooked > 0
          ? Math.round((inPersonCompleted / inPersonBooked) * 10000) / 100
          : 0,
      showRateVirtual:
        virtualBooked > 0
          ? Math.round((virtualCompleted / virtualBooked) * 10000) / 100
          : 0,
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
      grossProfitBySource,
      mikeAppts,
      mikeOffers: weekOpps.filter((o) => o.category === "offer_mike").length,
      mikeSigned: weekOpps.filter(
        (o) => o.category === "ab_signed" && o.closer === "Mike"
      ).length,
      mikeSettled: weekOpps.filter(
        (o) => o.category === "settled" && o.closer === "Mike"
      ).length,
      joshAppts,
      joshOffers: weekOpps.filter((o) => o.category === "offer_josh").length,
      joshSigned: weekOpps.filter(
        (o) => o.category === "ab_signed" && o.closer === "Josh"
      ).length,
      joshSettled: weekOpps.filter(
        (o) => o.category === "settled" && o.closer === "Josh"
      ).length,
      monthSplits,
    };
  });

  return {
    weeks: weekData,
    lastUpdated: new Date().toISOString(),
  };
}
