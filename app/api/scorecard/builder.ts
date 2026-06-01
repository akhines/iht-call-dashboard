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

// CONTACT_TYPE_FIELD removed: leads are now defined by pipeline membership,
// not the Contact Type custom field. See ACTIVE_SELLER_PIPELINES below.
const MARKETING_CAMPAIGN_FIELD = "4fOhwf1m5nhK1c9vI6SJ";

const JAN1_2026 = new Date("2026-01-01T00:00:00Z").getTime();

// ============ ACTIVE SELLER PIPELINE WHITELIST ============
// A "Lead" is a contact whose dateAdded falls in the ET week AND has ≥1 opp
// in one of these 7 active seller pipelines (any opp status — open/won/lost/abandoned).
// Excluded by design: Dispo, Wholesalers, Objection Proof, Prospecting.
const ACTIVE_SELLER_PIPELINES: Record<string, string> = {
  "6tntgcGDlTyw30KUgRrS": "Leads",
  "nwSjS0rUTMGbgDvyrEe4": "Mike the Closer",
  "ggnBpwig6OE37fXPQv7a": "Josh The Closer",
  "jTIXfKdqlRKALGw8fj4e": "Offer Followup",
  "ofMQolXiKGyg6WNOJS88": "Transaction Coordination",
  "DiGXnGTlQCOMZQJmWQe9": "Deals",
  "WLFdj0t3NfI17P0zuFsX": "Dead/No Opportunity",
};
const ACTIVE_SELLER_PIPELINE_IDS = new Set(Object.keys(ACTIVE_SELLER_PIPELINES));

// IHT staff/partner contact IDs — never counted as leads even if they match
// the pipeline filter. See reference_iht_staff_exclusions.md.
const STAFF_CONTACT_IDS = new Set([
  "WEtAovPOBN67adJz671d", // Ashley Hines
  "c6jnaA1kwoquJ99YBH5t", // Josh
  "NWn13wL32EF9aK45YrgV", // Mike
  "CX524fgj8qR5EAxQPN1V", // Nicole
  "x5TFIus7WluaEKE8BRPd", // Emma
  "Zman2TPuWizxEu0tFZHe", // admin@
  "G6qzpAanqlfhO4vt4Cpc", // Michael Aubele
]);
const STAFF_EMAIL_SUFFIX = "@theimpacthometeam.com";

// Outbound-only exclusion: contacts auto-created when a rep dialed an unknown
// number. createdBy.source === "lc-phone-api" + zero inbound messages anywhere
// in the conversation history → outbound dial-out, seller never engaged.
// See project_scorecard_leads_rule.md (Exclusion 3).
const LC_PHONE_API_SOURCE = "lc-phone-api";

// BCDI categorical exclusion: any contact whose `source` matches /^BCDI/i is
// an outbound prospecting target from a BCDI list (BCDI-CaseSearch, BCDI-ROW,
// BCDI-VacantList, BCDI-Estate, etc.) — not an inbound lead. Categorical
// regardless of engagement. See project_scorecard_leads_rule.md (Exclusion 4).
const BCDI_SOURCE_PATTERN = /^BCDI/i;

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

// ============ WEEK HELPERS (America/New_York, DST-safe) ============

interface Week {
  start: Date;   // Monday 00:00:00 ET (absolute instant)
  end: Date;     // Sunday 23:59:59 ET (absolute instant)
  key: string;   // "2026-01-05" — ET-local Monday calendar date
}

// Get the calendar components of an absolute instant as observed in
// America/New_York. DST-safe — relies on Intl which honors the IANA tz db.
function getEtParts(d: Date): { y: number; m: number; day: number; hour: number; min: number; sec: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((a, p) => {
    a[p.type] = p.value;
    return a;
  }, {});
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Intl returns hour "24" at midnight in some locales — coerce to 0.
  const hour = parts.hour === "24" ? 0 : parseInt(parts.hour, 10);
  return {
    y: parseInt(parts.year, 10),
    m: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    min: parseInt(parts.minute, 10),
    sec: parseInt(parts.second, 10),
    weekday: weekdayMap[parts.weekday] ?? 0,
  };
}

// Build an absolute Date that represents the given ET wall-clock instant
// (y, m, day, hour, min, sec). Solves the inverse of getEtParts. Works around
// DST gaps/overlaps by iterating until the round-trip matches.
function etWallClockToDate(y: number, m: number, day: number, hour = 0, min = 0, sec = 0): Date {
  // First guess: treat the wall clock as UTC, then adjust by the ET offset
  // we observe for that instant.
  const guess = new Date(Date.UTC(y, m - 1, day, hour, min, sec));
  const parts = getEtParts(guess);
  // Diff: the wall clock we want vs. what the guess actually renders as in ET.
  const targetMs = Date.UTC(y, m - 1, day, hour, min, sec);
  const renderedMs = Date.UTC(parts.y, parts.m - 1, parts.day, parts.hour, parts.min, parts.sec);
  const offsetMs = targetMs - renderedMs;
  return new Date(guess.getTime() + offsetMs);
}

function etDateKey(y: number, m: number, day: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function getWeeks2026(): Week[] {
  const weeks: Week[] = [];
  // Anchor: Monday 2026-01-05 00:00:00 ET
  let mondayY = 2026;
  let mondayM = 1;
  let mondayD = 5;
  const now = new Date();

  while (true) {
    const start = etWallClockToDate(mondayY, mondayM, mondayD, 0, 0, 0);
    // End = Sunday 23:59:59 ET, i.e. +6 days at 23:59:59
    const nextMondayDate = new Date(start.getTime() + 7 * 86400000);
    const nextMondayParts = getEtParts(nextMondayDate);
    const end = etWallClockToDate(
      nextMondayParts.y, nextMondayParts.m, nextMondayParts.day, 0, 0, 0
    );
    // end is the absolute instant of NEXT Monday 00:00 ET. Subtract 1s to land on
    // Sunday 23:59:59 ET.
    const sundayEnd = new Date(end.getTime() - 1000);

    // Only include weeks whose Sunday-end has already passed (i.e. fully closed weeks).
    if (sundayEnd.getTime() < now.getTime()) {
      weeks.push({
        start,
        end: sundayEnd,
        key: etDateKey(mondayY, mondayM, mondayD),
      });
    } else {
      break;
    }

    // Advance Monday by 7 ET days. Compute via the absolute next Monday and
    // re-extract its ET wall-clock components (handles DST shifts cleanly).
    mondayY = nextMondayParts.y;
    mondayM = nextMondayParts.m;
    mondayD = nextMondayParts.day;
  }
  return weeks;
}

function findWeekKey(date: Date, weeks: Week[]): string | null {
  const t = date.getTime();
  for (const w of weeks) {
    if (t >= w.start.getTime() && t <= w.end.getTime()) {
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

// Per-contact lead detail captured by fetchAllSellerContacts2026 and
// surfaced in the per-week scorecard payload for the drilldown UI.
export interface LeadRecord {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string;
  dateAdded: number;
  primaryPipelineId: string;
  primaryPipelineName: string;
  source: string;
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
  // New drilldown fields populated by the pipeline-based leads rewrite.
  // Counts per whitelisted pipeline ID (e.g. { "6tntgcGDlTyw30KUgRrS": 8, ... })
  leadsByPipeline?: Record<string, number>;
  // Counts per resolved source string (Marketing Campaign field → contact.source → "Unknown")
  leadsByChannel?: Record<string, number>;
  // Full per-lead detail, sorted by dateAdded ascending. Drives the scrollable
  // drilldown list with names linked to GHL contact detail pages.
  leadDetails?: LeadRecord[];
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
// the weekly cron. Returns the list of Monday-ET keys that the default cron
// invocation should rebuild — every other week stays locked.
// Matches getWeeks2026 which uses ET Monday-anchored weeks.
export function getCronTargetWeekKeys(now: Date = new Date()): string[] {
  // Walk back from now's ET wall-clock date to the most recent Monday.
  const parts = getEtParts(now);
  // weekday: 0=Sun, 1=Mon, ..., 6=Sat. Offset to current Monday.
  const offsetToMonday = parts.weekday === 0 ? -6 : 1 - parts.weekday;
  const todayAtMidnightEt = etWallClockToDate(parts.y, parts.m, parts.day, 0, 0, 0);
  const thisMondayInstant = new Date(todayAtMidnightEt.getTime() + offsetToMonday * 86400000);
  const thisMondayParts = getEtParts(thisMondayInstant);
  const thisMonday = etDateKey(thisMondayParts.y, thisMondayParts.m, thisMondayParts.day);
  const lastMondayInstant = new Date(thisMondayInstant.getTime() - 7 * 86400000);
  const lastMondayParts = getEtParts(lastMondayInstant);
  const lastMonday = etDateKey(lastMondayParts.y, lastMondayParts.m, lastMondayParts.day);
  return [lastMonday, thisMonday];
}

// ============ DATA FETCHERS ============

// Public type: per-contact lead detail. New pipeline-based logic — a "Lead" is
// a contact whose dateAdded is in 2026 AND has at least one opportunity in
// the active seller pipeline whitelist (any opp status). Contact Type +
// address1 are no longer used as filters.
//
// Implementation: invert the join. Fetch every opportunity in each
// whitelisted pipeline (cheap — 7 pipelines × ~100 opps/page) and build a
// contactId → primary-pipeline map. THEN page through /contacts/search
// filtered by dateAdded in 2026 (bcdi-known-good pattern using integer
// page param + sort asc) and keep only contacts whose ID is in the
// whitelist map. Drop staff. Yields the LeadRecord[] used downstream.
export async function fetchAllSellerContacts2026(): Promise<LeadRecord[]> {
  // ----- Phase 1: build the contact-ID → primary-pipeline map.
  // We use lastStageChangeAt as the "most recent stage change" tiebreaker
  // when a contact has opps in multiple whitelisted pipelines.
  //
  // Serialized across pipelines + paced between page fetches because GHL
  // rate-limits aggressively (429 returns "Too Many Requests" within
  // milliseconds when this runs alongside the rest of the scorecard build).
  const contactToPipeline = new Map<string, { pipelineId: string; stageMs: number }>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function fetchWith429Retry(url: string, body?: object, method: "GET" | "POST" = "GET"): Promise<Response | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const init: RequestInit = {
        method,
        headers: body
          ? { ...getHeaders(), "Content-Type": "application/json" }
          : getHeaders(),
      };
      if (body) init.body = JSON.stringify(body);
      const res = await fetch(url, init);
      if (res.status !== 429) return res;
      const wait = 1500 * (attempt + 1);
      console.warn(`[Scorecard] 429 on ${url.slice(0, 80)} attempt=${attempt + 1}, backing off ${wait}ms`);
      await sleep(wait);
    }
    return null;
  }

  for (const pid of Array.from(ACTIVE_SELLER_PIPELINE_IDS)) {
    let url = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pid}&limit=100`;
    let pageCount = 0;
    while (pageCount < 50) {
      pageCount++;
      const res = await fetchWith429Retry(url);
      if (!res || !res.ok) {
        console.warn(
          `[Scorecard] /opportunities/search pipeline=${pid} page=${pageCount} failed (${res?.status ?? "no response"})`
        );
        break;
      }
      const data = await res.json();
      const opps: Array<{
        contactId?: string;
        lastStageChangeAt?: string;
      }> = data.opportunities || [];
      for (const o of opps) {
        const cid = o.contactId || "";
        if (!cid) continue;
        const stageMs = o.lastStageChangeAt
          ? new Date(o.lastStageChangeAt).getTime()
          : 0;
        const prev = contactToPipeline.get(cid);
        if (!prev || stageMs > prev.stageMs) {
          contactToPipeline.set(cid, { pipelineId: pid, stageMs });
        }
      }
      const next = data?.meta?.nextPageUrl;
      if (!next) break;
      url = next;
      // Pace requests to avoid rate-limit storms.
      await sleep(200);
    }
    // Inter-pipeline pause.
    await sleep(300);
  }

  console.log(
    `[Scorecard] Pipeline-membership map built: ${contactToPipeline.size} unique contactIds across ${ACTIVE_SELLER_PIPELINE_IDS.size} pipelines`
  );

  // ----- Phase 2: page through contacts (filtered to 2026) using the
  // bcdi-known-good shape: POST /contacts/search with `page` integer +
  // pageLimit + sort asc. Keep only contacts whose ID is in the
  // pipeline-membership map.
  const leads: LeadRecord[] = [];
  const nowIso = new Date().toISOString();
  const jan1Iso = new Date(JAN1_2026).toISOString();
  const seen = new Set<string>();

  let page = 1;
  const PAGE_LIMIT = 100;
  const MAX_PAGES = 200; // safety cap; covers ~20k contacts/year

  // Per-contact helpers for the two outbound exclusions. Run AFTER the cheap
  // whitelist + staff + BCDI filters, so we only spend API calls on contacts
  // that would otherwise become leads.
  //
  // hasInbound(contactId):
  //   Short-circuit via /conversations/search?contactId=… — if ANY thread's
  //   lastMessageDirection is "inbound", contact has inbound, no message
  //   pagination needed. Only when every thread is outbound do we paginate
  //   /conversations/{id}/messages to scan for any inbound. Returns true if
  //   we find inbound, false if confirmed all-outbound, null on API failure
  //   (treat null as "keep" — never exclude on API failure).
  async function hasInbound(contactId: string): Promise<boolean | null> {
    const convRes = await fetchWith429Retry(
      `${BASE}/conversations/search?locationId=${LOCATION_ID()}&contactId=${contactId}`
    );
    if (!convRes || !convRes.ok) return null;
    const convData = await convRes.json();
    const threads: Array<{ id?: string; lastMessageDirection?: string }> =
      convData.conversations || [];
    if (threads.length === 0) return false; // no threads at all → no inbound
    // Short-circuit: any thread with lastMessageDirection === "inbound" → keep.
    for (const t of threads) {
      if (t.lastMessageDirection === "inbound") return true;
    }
    // All threads' last message is outbound — but earlier messages in a thread
    // could be inbound. Paginate messages for each thread until inbound found
    // or all exhausted.
    for (const t of threads) {
      if (!t.id) continue;
      let nextPage: string | null = null;
      let scanned = 0;
      const MAX_MSG_PAGES = 10; // safety cap; ~1000 messages per thread max
      for (let p = 0; p < MAX_MSG_PAGES; p++) {
        const url = nextPage
          ? `${BASE}/conversations/${t.id}/messages?lastMessageId=${nextPage}`
          : `${BASE}/conversations/${t.id}/messages`;
        const r = await fetchWith429Retry(url);
        if (!r || !r.ok) break;
        const body = await r.json();
        // Endpoint returns { messages: { messages: [...], nextPage } }
        const inner = body.messages || body;
        const msgs: Array<{ direction?: string }> = inner.messages || [];
        scanned += msgs.length;
        for (const m of msgs) {
          if (m.direction === "inbound") return true;
        }
        const np = inner.nextPage;
        if (!np) break;
        nextPage = np;
        await sleep(150);
      }
      void scanned;
    }
    return false; // verified all-outbound across every thread + page
  }

  while (page <= MAX_PAGES) {
    const body = {
      locationId: LOCATION_ID(),
      page,
      pageLimit: PAGE_LIMIT,
      sort: [{ field: "dateAdded", direction: "asc" }],
      filters: [
        {
          field: "dateAdded",
          operator: "range",
          value: { gte: jan1Iso, lte: nowIso },
        },
      ],
    };

    const res = await fetchWith429Retry(
      `${BASE}/contacts/search`,
      body,
      "POST"
    );
    if (!res || !res.ok) {
      const errBody = res ? await res.text().catch(() => "") : "no response";
      console.warn(
        `[Scorecard] /contacts/search failed (${res?.status ?? "n/a"}) on page ${page}: ${errBody.slice(0, 300)}`
      );
      break;
    }
    const data = await res.json();
    const contacts = data.contacts || [];
    if (contacts.length === 0) break;
    await processContacts(contacts);
    if (contacts.length < PAGE_LIMIT) break;
    page++;
    // Pace requests to keep the 429 budget healthy through ~1500 contacts.
    await sleep(150);
  }

  // Concurrency limit for the per-contact detail + inbound checks. Tuned
  // against GHL's 429 budget — 8 in-flight observed safe in BCDI scraper.
  const PER_CONTACT_CONCURRENCY = 8;

  async function processContacts(contacts: Array<Record<string, unknown>>) {
    let bcdiExcluded = 0;
    let lcPhoneApiChecked = 0;
    let lcPhoneApiExcluded = 0;

    // ----- Pass 1 (synchronous): apply all cheap filters and collect the
    // survivors that need the per-contact GET. Exclusion 4 (BCDI) happens
    // here — no API call required.
    type Candidate = {
      cid: string;
      c: Record<string, unknown>;
      membership: { pipelineId: string; stageMs: number };
      createdMs: number;
      contactSourceRaw: string;
    };
    const candidates: Candidate[] = [];
    for (const c of contacts) {
      const cid = (c.id as string) || "";
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      if (STAFF_CONTACT_IDS.has(cid)) continue;
      const email = ((c.email as string) || "").toLowerCase();
      if (email && email.endsWith(STAFF_EMAIL_SUFFIX)) continue;

      const membership = contactToPipeline.get(cid);
      if (!membership) continue;

      const createdMs = c.dateAdded ? new Date(c.dateAdded as string).getTime() : 0;
      if (!createdMs || createdMs < JAN1_2026) continue;

      // Exclusion 4 (BCDI categorical) — see project_scorecard_leads_rule.md.
      const contactSourceRaw = ((c.source as string) || "").trim();
      if (BCDI_SOURCE_PATTERN.test(contactSourceRaw)) {
        bcdiExcluded++;
        continue;
      }

      candidates.push({ cid, c, membership, createdMs, contactSourceRaw });
    }

    // ----- Pass 2: parallel detail fetches (capped concurrency) to discover
    // createdBy.source. /contacts/search strips that field, so we must GET
    // /contacts/{id} for every survivor. Each batch settles before the next
    // starts — keeps in-flight requests bounded at PER_CONTACT_CONCURRENCY.
    const createdBySourceByCid = new Map<string, string>();
    for (let i = 0; i < candidates.length; i += PER_CONTACT_CONCURRENCY) {
      const slice = candidates.slice(i, i + PER_CONTACT_CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (cand) => {
          const r = await fetchWith429Retry(`${BASE}/contacts/${cand.cid}`);
          if (!r || !r.ok) return "";
          const detail = await r.json();
          const createdBy = (detail?.contact?.createdBy || {}) as {
            source?: string;
          };
          return (createdBy.source || "").trim();
        })
      );
      for (let j = 0; j < slice.length; j++) {
        createdBySourceByCid.set(slice[j].cid, results[j]);
      }
      // Light pacing between batches.
      await sleep(80);
    }

    // ----- Pass 3: for candidates whose createdBy.source === lc-phone-api,
    // run the inbound check in parallel batches. Exclusion 3.
    const lcPhoneApiCands = candidates.filter(
      (cand) => createdBySourceByCid.get(cand.cid) === LC_PHONE_API_SOURCE
    );
    lcPhoneApiChecked += lcPhoneApiCands.length;
    const excludedCids = new Set<string>();
    for (let i = 0; i < lcPhoneApiCands.length; i += PER_CONTACT_CONCURRENCY) {
      const slice = lcPhoneApiCands.slice(i, i + PER_CONTACT_CONCURRENCY);
      const results = await Promise.all(slice.map((cand) => hasInbound(cand.cid)));
      for (let j = 0; j < slice.length; j++) {
        // inbound === false → confirmed all-outbound → exclude.
        // inbound === null → API failure → keep (never exclude on failure).
        if (results[j] === false) {
          excludedCids.add(slice[j].cid);
          lcPhoneApiExcluded++;
        }
      }
      await sleep(80);
    }

    // ----- Pass 4: emit LeadRecord for every candidate that survived.
    for (const cand of candidates) {
      if (excludedCids.has(cand.cid)) continue;
      const { c, cid, membership, createdMs, contactSourceRaw } = cand;
      const cfs: Record<string, string> = {};
      const customFields = (c.customFields as Array<{
        id?: string;
        value?: unknown;
        fieldValue?: unknown;
        fieldValueString?: unknown;
      }>) || [];
      for (const cf of customFields) {
        const val = cf.value ?? cf.fieldValue ?? cf.fieldValueString ?? "";
        if (cf.id) cfs[cf.id] = String(val);
      }
      const campaign = (cfs[MARKETING_CAMPAIGN_FIELD] || "").trim();
      const source = campaign || contactSourceRaw || "Unknown";

      if (campaign || contactSourceRaw) {
        contactSourceCache.set(cid, campaign || contactSourceRaw);
      }

      leads.push({
        contactId: cid,
        firstName: ((c.firstName as string) || "").trim(),
        lastName: ((c.lastName as string) || "").trim(),
        email: ((c.email as string) || "").toLowerCase(),
        dateAdded: createdMs,
        primaryPipelineId: membership.pipelineId,
        primaryPipelineName: ACTIVE_SELLER_PIPELINES[membership.pipelineId] || "",
        source,
      });
    }

    if (bcdiExcluded || lcPhoneApiChecked) {
      console.log(
        `[Scorecard] Exclusion stats (page batch): candidates=${candidates.length} BCDI=${bcdiExcluded} lcPhoneApiChecked=${lcPhoneApiChecked} lcPhoneApiExcluded=${lcPhoneApiExcluded}`
      );
    }
  }

  console.log(
    `[Scorecard] fetchAllSellerContacts2026: ${leads.length} leads (after pipeline+staff filter) across ${page} pages of contacts/search`
  );

  // Sort ascending by dateAdded for stable drilldown order.
  leads.sort((a, b) => a.dateAdded - b.dateAdded);
  return leads;
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
    // Don't cache the failure — let the next call retry. Caching "Other" on
    // a rate-limit/timeout silently buries the real source for the rest of
    // the run.
    return "Other";
  }
  const data = await res.json();
  const c = data.contact || {};
  const cfs: Record<string, string> = {};
  for (const cf of c.customFields || []) cfs[cf.id] = cf.value;
  const campaign = cfs[MARKETING_CAMPAIGN_FIELD] || "";
  const resolved = campaign || c.source || "";
  // GUARDRAIL 3: Only cache when we actually resolved a source. A
  // successful 200 with empty source+campaign is still "no signal";
  // caching "Other" buries the real value if it lands in customFields
  // on a later request. Return the fallback without persisting it.
  if (!resolved) return "Other";
  contactSourceCache.set(contactId, resolved);
  return resolved;
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
  const [allCalls, allLeads, allAppts] = await Promise.all([
    fetchAllCalls2026(),
    fetchAllSellerContacts2026(),
    fetchAllAppointments2026(),
  ]);
  const allOpps = await fetchAllOpportunities2026();
  console.log(
    `Scorecard: ${allCalls.length} calls, ${allLeads.length} leads, ${allAppts.length} appts, ${allOpps.length} opps`
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

    const weekLeads = allLeads.filter((l) => {
      const wk = findWeekKey(new Date(l.dateAdded), weeks);
      return wk === w.key;
    });
    const leads = weekLeads.length;
    // `prospects` retained on the payload for backward-compat with any caller
    // still reading the old shape — mirrors `leads` until the column is
    // removed from the UI in a follow-up.
    const prospects = leads;

    const leadsByPipeline: Record<string, number> = {};
    const leadsByChannel: Record<string, number> = {};
    for (const l of weekLeads) {
      leadsByPipeline[l.primaryPipelineId] = (leadsByPipeline[l.primaryPipelineId] || 0) + 1;
      const ch = l.source || "Unknown";
      leadsByChannel[ch] = (leadsByChannel[ch] || 0) + 1;
    }

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
    weekLeads.forEach((l) => {
      const src = l.source || "Unknown";
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
    // April, not March. ET-anchored to match the new week boundary logic.
    const startMonthIdx = getEtParts(w.start).m - 1;
    const endMonthIdx = getEtParts(w.end).m - 1;
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
          timeZone: "America/New_York",
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

    // startDate / endDate use ET-local calendar dates so a week labeled
    // "2026-05-18" reads the same as the GHL Monday it represents in ET.
    const startEt = getEtParts(w.start);
    const endEt = getEtParts(w.end);
    return {
      startDate: etDateKey(startEt.y, startEt.m, startEt.day),
      endDate: etDateKey(endEt.y, endEt.m, endEt.day),
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
      leadsByPipeline,
      leadsByChannel,
      leadDetails: weekLeads,
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
