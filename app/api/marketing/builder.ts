import { kv } from "@vercel/kv";
import {
  FRESH_KEY as SCORECARD_FRESH_KEY,
  weekKey as scorecardWeekKey,
  fetchAllSellerContacts2026,
  type ScorecardCachePayload,
  type WeekCacheEntry as ScorecardWeekCacheEntry,
  type WeekData as ScorecardWeekData,
} from "../scorecard/builder";

export const FRESH_KEY = "marketing_cache_v3";
export const MANUAL_INPUTS_KEY = "marketing_inputs";

// Per-week historical lock — see scorecard/builder.ts for the same pattern.
// Each entry stores ONE week's marketing metrics + frozen timestamp. Cron
// only rebuilds current + last week; every other week stays locked.
export const WEEK_KEY_PREFIX = "marketing_week_v1_";
export function weekKey(monday: string): string {
  return `${WEEK_KEY_PREFIX}${monday}`;
}

const BASE = "https://services.leadconnectorhq.com";
const BCDI_BASE = "https://bcdi-api.fly.dev";

// TV agency fees on top of media spend.
// Allocated to the first builder-week of each calendar month from
// engagement start; annual fee allocated to the first week of January.
const TV_AGENCY_MONTHLY_FEE = 997;
const TV_AGENCY_ANNUAL_FEE = 5000;
const TV_AGENCY_ANNUAL_MONTH = 1; // 1 = January
const TV_AGENCY_START = "2026-01-01"; // YYYY-MM-DD; weeks before this get $0 fees

interface SheetSpendRow {
  startDate: string;
  endDate: string;
  tvSpend: number;
  ppcSpend: number;
  mailSpend: number;
}

// Per-week spend pulled from the canonical Google Sheet
// ('2026 Marketing Scorecard' cols I/O/U) via bcdi-api. Source of truth
// for TV / PPC / Mail spend — replaces the empty Vercel KV manual_inputs
// map. Map is keyed by YYYY-MM-DD start date so it can match the
// `weekKey` we derive locally.
async function fetchWeeklySpend(): Promise<Map<string, SheetSpendRow>> {
  const map = new Map<string, SheetSpendRow>();
  try {
    const res = await fetch(`${BCDI_BASE}/api/marketing/weekly-spend`, {
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(
        `Marketing: weekly-spend fetch failed ${res.status}; falling back to manual_inputs only`
      );
      return map;
    }
    const data = await res.json();
    for (const w of data.weeks || []) {
      if (!w.startDate) continue;
      map.set(w.startDate, {
        startDate: w.startDate,
        endDate: w.endDate,
        tvSpend: Number(w.tvSpend) || 0,
        ppcSpend: Number(w.ppcSpend) || 0,
        mailSpend: Number(w.mailSpend) || 0,
      });
    }
    console.log(`Marketing: pulled spend for ${map.size} weeks from sheet`);
  } catch (err) {
    console.warn(
      "Marketing: weekly-spend fetch errored, falling back to manual_inputs only:",
      err
    );
  }
  return map;
}

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
const MARKETING_CAMPAIGN_FIELD = "4fOhwf1m5nhK1c9vI6SJ";

const JAN1_2026 = new Date("2026-01-01T00:00:00Z").getTime();

function getChannel(source: string, campaign: string): string {
  // Per Ashley 2026-05-11: Marketing Campaign custom field
  // (4fOhwf1m5nhK1c9vI6SJ) is the AUTHORITATIVE signal — that's what her
  // GHL Smart List filters use. `c.source` is checked only as a fallback
  // when Marketing Campaign is blank.
  //
  // Order matters — check PPC BEFORE TV so that "PPC: Google Ads" doesn't
  // get caught by the "tv" prefix check.
  const matchOne = (raw: string): string | null => {
    const s = (raw || "").toLowerCase().trim();
    if (!s) return null;
    if (s.includes("ppc") || s.includes("google ads")) return "PPC";
    if (
      s.includes("seo") ||
      s.includes("google search") ||
      s.includes("organic") ||
      s.includes("gmb") ||
      s.includes("google my business")
    )
      return "SEO";
    if (s.includes("direct mail") || s.includes("probate")) return "Mail";
    if (s.startsWith("tv") || /\btv\b/.test(s)) return "TV";
    if (s.includes("ppl") || s.includes("pay per lead")) return "PPL";
    if (s.includes("referral")) return "Referral";
    if (s.includes("mail")) return "Mail";
    if (
      s.includes("emma") ||
      s.includes("josh smrt") ||
      s.includes("callrail") ||
      s.includes("other: not found")
    )
      return "Other";
    return null;
  };
  return matchOne(campaign) || matchOne(source) || "Other";
}

interface Week {
  start: Date;
  end: Date;
  key: string;
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
    if (t >= w.start.getTime() && t <= w.end.getTime() + 86400000) return w.key;
  }
  return null;
}

interface LeadRecord {
  date: number;
  channel: string;
  hasAddress: boolean;
}
interface ApptRecord {
  date: number;
  channel: string;
  cancelled: boolean;
  completed: boolean;
}
interface DealRecord {
  date: number;
  channel: string;
  category: string;
  monetaryValue: number;
}

const contactSourceCache = new Map<string, string>();

function getContactChannelCached(contactId: string): string | null {
  if (!contactId) return null;
  return contactSourceCache.get(contactId) || null;
}

// Resolve channel for an opportunity. Priority:
// 1. Opportunity's own `source` field (carries contact source — set by GHL workflow)
// 2. Contact source cache (set during fetchAllSellerLeads from contact source+campaign)
// 3. "Other" as final fallback (logged so we can spot mis-attributions)
//
// Why opp.source FIRST: the contact-source cache can mis-classify older leads
// as "Other" when fetchAllSellerLeads doesn't see `source` on a paginated
// contacts listing. opp.source is set authoritatively at opp creation by the
// GHL workflow (e.g., "TV AD", "PPC: Google Ads") and is the most reliable
// signal. Cache is still consulted as a fallback when opp.source is blank.
function resolveOppChannel(opp: { contactId?: string; source?: string }): string {
  if (opp.source) {
    const fromOpp = getChannel(opp.source, "");
    if (fromOpp !== "Other") return fromOpp;
  }
  const cached = opp.contactId ? getContactChannelCached(opp.contactId) : null;
  if (cached && cached !== "Other") return cached;
  return "Other";
}

// Async resolver — used ONLY for settled deals (high-value, low-volume).
// Same priority as resolveOppChannel but adds a final contact-fetch fallback
// when both opp.source and cache miss.
async function resolveOppChannelAsync(opp: {
  contactId?: string;
  source?: string;
}): Promise<string> {
  if (opp.source) {
    const fromOpp = getChannel(opp.source, "");
    if (fromOpp !== "Other") return fromOpp;
  }
  const cached = opp.contactId ? getContactChannelCached(opp.contactId) : null;
  if (cached && cached !== "Other") return cached;
  // Final resort: fetch the contact directly to read source + Marketing Campaign field
  if (opp.contactId) {
    try {
      const r = await fetch(`${BASE}/contacts/${opp.contactId}`, {
        headers: getHeaders(),
      });
      if (r.ok) {
        const data = await r.json();
        const c = data.contact || {};
        const cfs: Record<string, string> = {};
        for (const cf of c.customFields || []) cfs[cf.id] = cf.value;
        const campaign = cfs[MARKETING_CAMPAIGN_FIELD] || "";
        const ch = getChannel(c.source || "", campaign);
        if (ch !== "Other") {
          contactSourceCache.set(opp.contactId, ch);
          return ch;
        }
      }
    } catch {
      // swallow — fall through to "Other"
    }
  }
  return "Other";
}

/**
 * Marketing leads input = the EXACT same set the Operations Scorecard counts.
 *
 * Delegates to scorecard/builder.fetchAllSellerContacts2026 so the unified
 * pipeline-based rule (7-pipeline whitelist + staff exclusion + Exclusion 3
 * lc-phone-api + Exclusion 4 BCDI categorical) applies here verbatim. The
 * old `hasAddress` + Marketing Campaign filter is gone — same rule as the
 * Operations Scorecard `leadsByChannel`.
 *
 * Each scorecard LeadRecord carries a pre-resolved `source` string
 * (customField.MarketingCampaign → contact.source → "Unknown"), which we
 * pass through getChannel() for the 7-bucket marketing rollup
 * (TV / PPC / Mail / PPL / Referral / Other / SEO).
 *
 * Side effect: every lead's resolved source is cached into
 * contactSourceCache so resolveOppChannel can use it as a downstream
 * fallback when an opp's own `source` field is blank.
 */
async function fetchAllSellerLeads(): Promise<LeadRecord[]> {
  const scorecardLeads = await fetchAllSellerContacts2026();
  const leads: LeadRecord[] = [];
  for (const sl of scorecardLeads) {
    const ch = getChannel(sl.source || "", "");
    if (sl.contactId && sl.source) {
      // Pre-populate cache with the SAME channel marketing will use,
      // so opp attribution stays consistent.
      contactSourceCache.set(sl.contactId, ch);
    }
    leads.push({
      date: sl.dateAdded,
      channel: ch,
      hasAddress: true, // pipeline-based rule: no address filter
    });
  }
  console.log(
    `Marketing: ${leads.length} leads from scorecard pipeline-based fetch; cached ${contactSourceCache.size} contact channels`
  );
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
    const events = data.events || [];

    for (const e of events) {
      if (e.deleted) continue;
      const titleLower = (e.title || "").toLowerCase();
      const status = e.appointmentStatus || "";
      const cancelled =
        status === "cancelled" ||
        titleLower.startsWith("c-") ||
        titleLower.includes("cancel");
      const endTime = new Date(e.endTime).getTime();

      appts.push({
        date: new Date(e.startTime).getTime(),
        channel: getContactChannelCached(e.contactId || "") || "Other",
        cancelled,
        completed: !cancelled && endTime < now,
      });
    }
  }
  return appts;
}

// Paginated opportunity search — mirrors scorecard/builder.ts' `fetchOppsByStage`
// pattern (data.meta.nextPageUrl loop, hard cap at 25 pages). The marketing
// builder previously stopped at the first 100 results, which silently dropped
// settled deals once we crossed that threshold (3 missing settled in YTD 2026).
interface RawOpp {
  id: string;
  contactId?: string;
  source?: string;
  pipelineStageId?: string;
  lastStageChangeAt?: string;
  createdAt?: string;
  monetaryValue?: number;
}

async function fetchAllOppsPaginated(
  pipelineId: string,
  stageId?: string
): Promise<RawOpp[]> {
  const results: RawOpp[] = [];
  const stageQs = stageId ? `&pipeline_stage_id=${stageId}` : "";
  let url: string | null = `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${pipelineId}${stageQs}&limit=100`;
  for (let page = 0; page < 25 && url; page++) {
    const res: Response = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    for (const o of data.opportunities || []) {
      results.push({
        id: o.id,
        contactId: o.contactId || "",
        source: o.source || "",
        pipelineStageId: o.pipelineStageId || "",
        lastStageChangeAt: o.lastStageChangeAt,
        createdAt: o.createdAt,
        monetaryValue: o.monetaryValue || 0,
      });
    }
    url = data?.meta?.nextPageUrl || null;
  }
  return results;
}

async function fetchAllDeals(): Promise<DealRecord[]> {
  const deals: DealRecord[] = [];

  // A-B signed (paginated)
  const tcOpps = await fetchAllOppsPaginated(TC_PIPELINE);
  for (const o of tcOpps) {
    const d = new Date(o.createdAt || 0).getTime();
    if (d < JAN1_2026) continue;
    const channel = resolveOppChannel(o);
    deals.push({
      date: d,
      channel,
      category: "ab",
      monetaryValue: o.monetaryValue || 0,
    });
  }

  // Closings from Mike/Josh closer pipelines (paginated)
  const closerStages = [
    { pipeline: MIKE_PIPELINE, stage: "64d1fa71-6952-41cd-be5e-1536715b6d87" },
    { pipeline: JOSH_PIPELINE, stage: "0c4afc64-8163-4723-9f78-d4a0d7e1d037" },
  ];
  for (const q of closerStages) {
    const opps = await fetchAllOppsPaginated(q.pipeline, q.stage);
    for (const o of opps) {
      const d = new Date(o.lastStageChangeAt || 0).getTime();
      if (d < JAN1_2026) continue;
      const ch = resolveOppChannel(o);
      deals.push({
        date: d,
        channel: ch,
        category: "closing",
        monetaryValue: o.monetaryValue || 0,
      });
    }
  }

  // Settled — merge of dealsClosedDeal + tcClosedDispo, deduped by opp id.
  // Mirrors scorecard/builder.ts (the marketing builder previously only queried
  // dealsClosedDeal AND was unpaginated, missing 3 settled deals in YTD 2026).
  const DEALS_PIPELINE = "DiGXnGTlQCOMZQJmWQe9";
  const STAGE_DEALS_CLOSED = "245bc5b3-e2ac-4886-8928-907560ec3f15";
  const STAGE_TC_CLOSED_DISPO = "8464b838-cb2d-497a-89f6-07c4025ae17f";

  const [closedA, closedB] = await Promise.all([
    fetchAllOppsPaginated(DEALS_PIPELINE, STAGE_DEALS_CLOSED),
    fetchAllOppsPaginated(TC_PIPELINE, STAGE_TC_CLOSED_DISPO),
  ]);
  const closedById = new Map<string, RawOpp>();
  for (const o of [...closedA, ...closedB]) {
    if (o.id && !closedById.has(o.id)) closedById.set(o.id, o);
  }
  const closedDeals = Array.from(closedById.values());
  console.log(
    `[Marketing] Settled candidates: dealsClosedDeal=${closedA.length}, tcClosedDispo=${closedB.length}, merged=${closedDeals.length}`
  );

  // Settled date = the moment the opp was moved into the Closed Deal stage
  // in Pipeline 7 (Deals). Per Ashley 2026-05-11: this is THE date a deal
  // counts as settled. The custom date fields (A-B Date Signed, Closing
  // Confirmed Date B-C, etc.) are inconsistently populated and shouldn't
  // be used. lastStageChangeAt on a status=won opp in Closed Deal stage
  // is reliable and present on every closed deal.
  //
  // Per-deal detail fetch is still required because GHL `/opportunities/search`
  // does NOT return the `source` field — only `/opportunities/{id}` does. Without
  // it, channel attribution falls through to "Other" for any contact whose
  // cached channel is missing/Other (Dorothy/Jerry/George/Hifza all hit this).
  const BATCH = 10;
  for (let i = 0; i < closedDeals.length; i += BATCH) {
    const slice = closedDeals.slice(i, i + BATCH);
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
      const opp = detail?.opportunity || detail || o;
      const stageChangeMs = opp.lastStageChangeAt
        ? new Date(opp.lastStageChangeAt).getTime()
        : 0;
      if (!stageChangeMs || stageChangeMs < JAN1_2026) continue;
      // Merge: prefer detail's source (always populated on the detail endpoint)
      // over the search-row source (often empty).
      const merged = {
        contactId: opp.contactId || o.contactId,
        source: opp.source || o.source,
      };
      const ch = await resolveOppChannelAsync(merged);
      deals.push({
        date: stageChangeMs,
        channel: ch,
        category: "settled",
        monetaryValue: opp.monetaryValue || o.monetaryValue || 0,
      });
    }
  }

  return deals;
}

const CHANNELS = ["TV", "PPC", "Mail", "PPL", "Referral", "Other", "SEO"] as const;

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

// Per-month split for a single channel, used on cross-month boundary weeks.
// Only the date-anchored metrics (leads/appts/ab/closings/settled/grossProfit)
// can be split — spend/mailersSent come from manual_inputs/sheet at week
// level so they can't be partitioned without per-day allocation.
export interface ChannelMonthSplit {
  leads: number;
  appts: number;
  ab: number;
  closings: number;
  settled: number;
  grossProfit: number;
}
// monthSplits[channelName][lowercaseMonthName] = ChannelMonthSplit.
// Only present on weeks where w.start.getUTCMonth() !== w.end.getUTCMonth().
export type MarketingMonthSplits = Record<
  string,
  Record<string, ChannelMonthSplit>
>;

export interface MarketingWeekData {
  weekKey: string;
  startDate: string;
  endDate: string;
  channels: Record<string, ChannelWeekData>;
  // Cross-month boundary weeks only — keeps MTD KPIs accurate when a deal
  // closes early in the next month within a week that spans both.
  monthSplits?: MarketingMonthSplits;
}

export interface MarketingData {
  weeks: MarketingWeekData[];
  channels: string[];
  lastUpdated: string;
}

export interface MarketingCachePayload {
  data: MarketingData;
  refreshedAt: string;
}

// One-week per-week store entry — written to `marketing_week_v1_{monday}`.
export interface MarketingWeekCacheEntry {
  data: MarketingWeekData;
  frozenAt: string;
}

export function getCronTargetWeekKeys(now: Date = new Date()): string[] {
  const t = new Date(now);
  t.setUTCHours(0, 0, 0, 0);
  const day = t.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  t.setUTCDate(t.getUTCDate() + offsetToMonday);
  const thisMonday = t.toISOString().slice(0, 10);
  const lastMonday = new Date(t);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
  return [lastMonday.toISOString().slice(0, 10), thisMonday];
}

function buildWeekData(
  weeks: Week[],
  allLeads: LeadRecord[],
  allAppts: ApptRecord[],
  allDeals: DealRecord[]
): MarketingWeekData[] {
  // Reconcile lead count to scorecard: only sellers WITH an address count
  // as "leads". Scorecard's /api/scorecard YTD uses `weekSellers.filter(
  // s => s.hasAddress)` to derive its leads number — without this filter
  // /api/marketing was reporting 205 (all sellers) vs scorecard's 191
  // (sellers with address). Filtering here keeps both surfaces aligned.
  const addressableLeads = allLeads.filter((l) => l.hasAddress);
  const monthNameOf = (ms: number): string =>
    new Date(ms)
      .toLocaleString("en-US", { month: "long", timeZone: "UTC" })
      .toLowerCase();
  return weeks.map((w) => {
    const channels: Record<string, ChannelWeekData> = {};
    const crossesMonth = w.start.getUTCMonth() !== w.end.getUTCMonth();
    const monthSplits: MarketingMonthSplits = {};
    const ensureChannelMonth = (
      ch: string,
      monthName: string
    ): ChannelMonthSplit => {
      if (!monthSplits[ch]) monthSplits[ch] = {};
      if (!monthSplits[ch][monthName]) {
        monthSplits[ch][monthName] = {
          leads: 0,
          appts: 0,
          ab: 0,
          closings: 0,
          settled: 0,
          grossProfit: 0,
        };
      }
      return monthSplits[ch][monthName];
    };
    for (const ch of CHANNELS) {
      const weekLeads = addressableLeads.filter(
        (l) => l.channel === ch && findWeekKey(new Date(l.date), weeks) === w.key
      );
      const weekAppts = allAppts.filter(
        (a) =>
          a.channel === ch &&
          !a.cancelled &&
          a.completed &&
          findWeekKey(new Date(a.date), weeks) === w.key
      );
      const weekAb = allDeals.filter(
        (d) =>
          d.channel === ch &&
          d.category === "ab" &&
          findWeekKey(new Date(d.date), weeks) === w.key
      );
      const weekClosings = allDeals.filter(
        (d) =>
          d.channel === ch &&
          d.category === "closing" &&
          findWeekKey(new Date(d.date), weeks) === w.key
      );
      const weekSettled = allDeals.filter(
        (d) =>
          d.channel === ch &&
          d.category === "settled" &&
          findWeekKey(new Date(d.date), weeks) === w.key
      );

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

      if (crossesMonth) {
        // Bucket every event into its own month for the boundary week.
        for (const l of weekLeads) {
          ensureChannelMonth(ch, monthNameOf(l.date)).leads += 1;
        }
        for (const a of weekAppts) {
          ensureChannelMonth(ch, monthNameOf(a.date)).appts += 1;
        }
        for (const d of weekAb) {
          ensureChannelMonth(ch, monthNameOf(d.date)).ab += 1;
        }
        for (const d of weekClosings) {
          ensureChannelMonth(ch, monthNameOf(d.date)).closings += 1;
        }
        for (const d of weekSettled) {
          const bucket = ensureChannelMonth(ch, monthNameOf(d.date));
          bucket.settled += 1;
          bucket.grossProfit += d.monetaryValue || 0;
        }
      }
    }
    return {
      weekKey: w.key,
      startDate: w.start.toISOString().slice(0, 10),
      endDate: w.end.toISOString().slice(0, 10),
      channels,
      monthSplits: crossesMonth ? monthSplits : undefined,
    };
  });
}

export function applyManualInputs(
  weekData: MarketingWeekData[],
  manualInputs: Record<
    string,
    Record<string, { spend?: number; mailersSent?: number }>
  >
): MarketingWeekData[] {
  return weekData.map((w) => {
    const channels: Record<string, ChannelWeekData> = { ...w.channels };
    for (const ch of CHANNELS) {
      const manual = manualInputs?.[w.weekKey]?.[ch];
      if (!manual) continue;
      // Sheet-driven spend (TV / PPC / Mail) is the source of truth — only
      // let manual_inputs override when the user typed a positive value.
      // mailersSent isn't on the sheet, so it always honors the manual map.
      const sheetDriven = ch === "TV" || ch === "PPC" || ch === "Mail";
      const manualSpend = manual.spend || 0;
      const nextSpend =
        sheetDriven && manualSpend === 0
          ? channels[ch].spend
          : manualSpend;
      channels[ch] = {
        ...channels[ch],
        spend: nextSpend,
        mailersSent: manual.mailersSent || 0,
      };
    }
    return { ...w, channels };
  });
}

/**
 * Merge per-week TV / PPC / Mail spend from the canonical Google Sheet
 * into the channel data. This is the source of truth for spend — the
 * KV manual_inputs map is no longer authoritative for these three
 * channels (it stays alive only for `mailersSent`, which doesn't live
 * in the sheet).
 *
 * Match strategy: each builder week has a `weekKey` of the form
 * YYYY-MM-DD (week-start). The sheet endpoint also keys by start date,
 * so an exact match is preferred. If the sheet's start date is off by
 * one day (sheet weeks run Mon→Sun while builder weeks run Mon→Sun
 * starting 2026-01-05; the sheet starts 2026-01-05 too) we also fall
 * back to a ±3-day window to be tolerant of any drift.
 */
/**
 * Inject TV agency fees on top of TV media spend. Allocates $997 to the
 * earliest builder-week of each calendar month, plus a $5,000 annual fee
 * to the first week of January each year. Only weeks on/after
 * TV_AGENCY_START are charged.
 *
 * Iterates in chronological order so the "first week of month" allocation
 * is deterministic regardless of input order. Exported so the GET route
 * can apply it AFTER reading from the per-week KV cache — that way
 * historically locked weeks pick up fee changes without a full rebuild.
 */
export function applyTvAgencyFees(weekData: MarketingWeekData[]): MarketingWeekData[] {
  if (weekData.length === 0) return weekData;
  // Map weekKey → fee amount so we can apply without re-sorting the output.
  const feeByWeek = new Map<string, number>();
  const monthSeen = new Set<string>(); // "YYYY-MM"
  const yearSeen = new Set<string>(); // "YYYY"
  const sorted = [...weekData].sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  for (const w of sorted) {
    if (w.weekKey < TV_AGENCY_START) continue;
    const ym = w.weekKey.slice(0, 7);
    const y = w.weekKey.slice(0, 4);
    let fee = 0;
    if (!monthSeen.has(ym)) {
      monthSeen.add(ym);
      fee += TV_AGENCY_MONTHLY_FEE;
    }
    const monthNum = parseInt(ym.slice(5, 7), 10);
    if (!yearSeen.has(y) && monthNum === TV_AGENCY_ANNUAL_MONTH) {
      yearSeen.add(y);
      fee += TV_AGENCY_ANNUAL_FEE;
    }
    if (fee > 0) feeByWeek.set(w.weekKey, fee);
  }
  if (feeByWeek.size === 0) return weekData;
  return weekData.map((w) => {
    const fee = feeByWeek.get(w.weekKey);
    if (!fee) return w;
    const tv = w.channels.TV;
    if (!tv) return w;
    return {
      ...w,
      channels: {
        ...w.channels,
        TV: { ...tv, spend: (tv.spend || 0) + fee },
      },
    };
  });
}

function applySheetSpend(
  weekData: MarketingWeekData[],
  sheetMap: Map<string, SheetSpendRow>
): MarketingWeekData[] {
  if (sheetMap.size === 0) return weekData;
  const sheetEntries = Array.from(sheetMap.values());
  return weekData.map((w) => {
    let row = sheetMap.get(w.weekKey);
    if (!row) {
      // Fall back to nearest start date within ±3 days
      const target = new Date(w.weekKey + "T00:00:00Z").getTime();
      let best: SheetSpendRow | undefined;
      let bestDelta = Infinity;
      for (const s of sheetEntries) {
        const t = new Date(s.startDate + "T00:00:00Z").getTime();
        const delta = Math.abs(t - target);
        if (delta < bestDelta && delta <= 3 * 86400000) {
          best = s;
          bestDelta = delta;
        }
      }
      row = best;
    }
    if (!row) return w;
    const channels: Record<string, ChannelWeekData> = { ...w.channels };
    if (channels.TV) channels.TV = { ...channels.TV, spend: row.tvSpend || 0 };
    if (channels.PPC)
      channels.PPC = { ...channels.PPC, spend: row.ppcSpend || 0 };
    if (channels.Mail)
      channels.Mail = { ...channels.Mail, spend: row.mailSpend || 0 };
    return { ...w, channels };
  });
}

/**
 * Read scorecard's KV cache and return a map of weekKey → ScorecardWeekData.
 *
 * Strategy (in order):
 *   1. Per-week keys `scorecard_week_v1_{monday}` via mget — this is the
 *      authoritative store the scorecard GET reads from.
 *   2. Legacy aggregate `scorecard_cache_v3` — fallback if per-week store
 *      is cold (e.g. fresh deploy hasn't run ?all=true yet).
 *   3. Empty map — caller falls back to marketing's own attribution.
 *
 * On miss we log loudly so a drift can be spotted in Vercel logs.
 */
async function fetchScorecardWeeksFromKV(
  weekKeys: string[]
): Promise<Map<string, ScorecardWeekData>> {
  const out = new Map<string, ScorecardWeekData>();
  try {
    const kvKeys = weekKeys.map((k) => scorecardWeekKey(k));
    const entries = (await kv.mget<ScorecardWeekCacheEntry[]>(...kvKeys)) || [];
    let perWeekHits = 0;
    for (let i = 0; i < weekKeys.length; i++) {
      const e = entries[i];
      if (e && e.data) {
        out.set(weekKeys[i], e.data);
        perWeekHits += 1;
      }
    }
    if (perWeekHits > 0) {
      console.log(
        `Marketing override: scorecard per-week store hit ${perWeekHits}/${weekKeys.length} weeks`
      );
    }
    if (perWeekHits === weekKeys.length) return out;

    // Per-week store partial / cold — fill gaps from legacy aggregate.
    const legacy = await kv.get<ScorecardCachePayload>(SCORECARD_FRESH_KEY);
    if (legacy && legacy.data && legacy.data.weeks) {
      let aggHits = 0;
      for (const w of legacy.data.weeks) {
        if (!out.has(w.startDate)) {
          out.set(w.startDate, w);
          aggHits += 1;
        }
      }
      if (aggHits > 0) {
        console.log(
          `Marketing override: scorecard legacy aggregate filled ${aggHits} additional weeks`
        );
      }
    }
  } catch (e) {
    console.warn(
      "Marketing override: scorecard KV read threw; falling back to local attribution:",
      e
    );
  }
  return out;
}

/**
 * OVERRIDE marketing's per-channel `settled` and `grossProfit` for every
 * week using scorecard's `settledBySource` + `grossProfitBySource`.
 *
 * Bucketing: each scorecard source string is mapped into a marketing
 * channel via the existing `getChannel(source, "")` function. So
 * "PPC: Google Ads" → PPC, "TV AD" / "TV AD (Forwarded ...)" → TV,
 * "Referral" → Other.
 *
 * Why: scorecard's `settledBySource` is the single source of truth for
 * settled deal counts and GP. Marketing's per-channel numbers were
 * computed via a parallel attribution path (resolveOppChannelAsync) that
 * occasionally drifted from scorecard truth — for YTD 2026 a PPC settled
 * deal misattributed as TV (PPC=4 vs scorecard's 5). Deriving from
 * scorecard removes the entire class of drift.
 *
 * monthSplits per-channel settled/GP also get overridden for the same
 * reason — using scorecard's `monthSplits.settled/grossProfit` lumped at
 * the week level we know the per-channel split via source bucketing of
 * the week's `settledBySource` ratio. (For cross-month boundary weeks
 * with multiple settled deals across channels AND months, we fall back
 * to marketing's own per-deal attribution since scorecard's monthSplit
 * loses the source dimension.)
 *
 * Untouched: leads, appts, ab, closings — they have their own
 * attribution paths and aren't part of the financial-decision surface
 * this fix is targeting.
 */
function overrideSettledFromScorecard(
  weekData: MarketingWeekData[],
  scorecardByWeek: Map<string, ScorecardWeekData>
): MarketingWeekData[] {
  if (scorecardByWeek.size === 0) {
    console.warn(
      "Marketing override: scorecard map empty — leaving local settled/GP in place"
    );
    return weekData;
  }

  return weekData.map((w) => {
    const scWeek = scorecardByWeek.get(w.weekKey);
    if (!scWeek) {
      console.warn(
        `Marketing override: no scorecard week for ${w.weekKey} — leaving local`
      );
      return w;
    }

    // Bucket scorecard's per-source counts + GP into marketing channels.
    const settledByChannel: Record<string, number> = {};
    const gpByChannel: Record<string, number> = {};
    for (const ch of CHANNELS) {
      settledByChannel[ch] = 0;
      gpByChannel[ch] = 0;
    }

    const settledBySource = scWeek.settledBySource || {};
    const gpBySource = scWeek.grossProfitBySource || {};

    for (const [source, count] of Object.entries(settledBySource)) {
      const ch = getChannel(source, "");
      settledByChannel[ch] = (settledByChannel[ch] || 0) + (count || 0);
    }
    for (const [source, gp] of Object.entries(gpBySource)) {
      const ch = getChannel(source, "");
      gpByChannel[ch] = (gpByChannel[ch] || 0) + (gp || 0);
    }

    // OVERWRITE per-channel settled + grossProfit. Leave everything else.
    const channels: Record<string, ChannelWeekData> = {};
    for (const ch of CHANNELS) {
      const existing = w.channels[ch] || {
        leads: 0,
        appts: 0,
        ab: 0,
        closings: 0,
        settled: 0,
        grossProfit: 0,
        spend: 0,
        mailersSent: 0,
      };
      channels[ch] = {
        ...existing,
        settled: settledByChannel[ch] || 0,
        grossProfit: gpByChannel[ch] || 0,
      };
    }

    // monthSplits: if scorecard week has monthSplits (cross-month boundary),
    // we need to scale per-channel settled/GP across months. Scorecard's
    // monthSplit gives total settled/GP per month but not per source — so
    // for boundary weeks we proportionally distribute the channel totals
    // by the month split ratio. If the week has only ONE month bucket
    // populated (the common case), the entire channel total goes there.
    let monthSplits = w.monthSplits;
    if (scWeek.monthSplits && Object.keys(scWeek.monthSplits).length > 0) {
      const monthEntries = Object.entries(scWeek.monthSplits);
      const totalSettledAcrossMonths = monthEntries.reduce(
        (a, [, m]) => a + (m.settled || 0),
        0
      );
      const totalGpAcrossMonths = monthEntries.reduce(
        (a, [, m]) => a + (m.grossProfit || 0),
        0
      );

      const newMonthSplits: MarketingMonthSplits = {};
      for (const ch of CHANNELS) {
        const existingChMs = w.monthSplits?.[ch] || {};
        newMonthSplits[ch] = {};
        // Preserve leads/appts/ab/closings month splits, only replace
        // settled + grossProfit per month.
        for (const [monthName, scMonth] of monthEntries) {
          const existing = existingChMs[monthName] || {
            leads: 0,
            appts: 0,
            ab: 0,
            closings: 0,
            settled: 0,
            grossProfit: 0,
          };
          // Proportional split of the channel's total settled/GP based on
          // the share of total settled/GP that fell in this month.
          const settledRatio =
            totalSettledAcrossMonths > 0
              ? (scMonth.settled || 0) / totalSettledAcrossMonths
              : 0;
          const gpRatio =
            totalGpAcrossMonths > 0
              ? (scMonth.grossProfit || 0) / totalGpAcrossMonths
              : 0;
          newMonthSplits[ch][monthName] = {
            ...existing,
            settled: Math.round((settledByChannel[ch] || 0) * settledRatio),
            grossProfit: (gpByChannel[ch] || 0) * gpRatio,
          };
        }
      }
      monthSplits = newMonthSplits;
    }

    return { ...w, channels, monthSplits };
  });
}

export async function buildFreshMarketing(): Promise<MarketingData> {
  const weeks = getWeeks2026();

  contactSourceCache.clear();

  // Fetch leads first to populate channel cache, then appts+deals+spend
  // in parallel.
  const allLeads = await fetchAllSellerLeads();
  const [allAppts, allDeals, sheetSpend] = await Promise.all([
    fetchAllAppts(),
    fetchAllDeals(),
    fetchWeeklySpend(),
  ]);
  console.log(
    `Marketing: ${allLeads.length} leads, ${allAppts.length} appts, ${allDeals.length} deals, ${sheetSpend.size} spend rows (channel cache: ${contactSourceCache.size})`
  );

  const baseWeekData = buildWeekData(weeks, allLeads, allAppts, allDeals);
  // Note: applyTvAgencyFees is applied at READ time (route.ts GET), not
  // build time, so fee changes apply to historically locked weeks
  // immediately without forcing a full rebuild.
  const withSpend = applySheetSpend(baseWeekData, sheetSpend);

  // OVERRIDE per-channel settled / grossProfit using scorecard's
  // settledBySource (single source of truth). Scorecard MUST be refreshed
  // FIRST so its KV has up-to-date settledBySource + grossProfitBySource.
  // If KV is cold or partial, we fall back to the local attribution we
  // just computed (logged loudly so drifts are spottable).
  const weekKeys = withSpend.map((w) => w.weekKey);
  const scorecardByWeek = await fetchScorecardWeeksFromKV(weekKeys);
  const weekData = overrideSettledFromScorecard(withSpend, scorecardByWeek);

  return {
    weeks: weekData,
    channels: CHANNELS as unknown as string[],
    lastUpdated: new Date().toISOString(),
  };
}

export const MARKETING_CHANNELS = CHANNELS;
