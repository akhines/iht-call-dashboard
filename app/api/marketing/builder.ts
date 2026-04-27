export const FRESH_KEY = "marketing_cache_v3";
export const MANUAL_INPUTS_KEY = "marketing_inputs";

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

const JAN1_2026 = new Date("2026-01-01T00:00:00Z").getTime();

function getChannel(source: string, campaign: string): string {
  const s = (source + " " + campaign).toLowerCase();
  if (s.includes("tv")) return "TV";
  if (s.includes("ppc") || s.includes("google ads")) return "PPC";
  if (s.includes("direct mail") || s.includes("mail")) return "Mail";
  if (s.includes("seo") || s.includes("google search") || s.includes("organic"))
    return "SEO";
  if (s.includes("ppl") || s.includes("pay per lead")) return "PPL";
  if (s.includes("gmb") || s.includes("google my business")) return "SEO";
  if (s.includes("referral")) return "Other";
  if (s.includes("probate")) return "Mail";
  if (
    s.includes("emma") ||
    s.includes("josh smrt") ||
    s.includes("callrail") ||
    s.includes("other: not found")
  )
    return "Other";
  return "Other";
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

function getContactChannelCached(contactId: string): string {
  if (!contactId) return "Other";
  return contactSourceCache.get(contactId) || "Other";
}

async function fetchAllSellerLeads(): Promise<LeadRecord[]> {
  const leads: LeadRecord[] = [];
  let startAfterId = "";
  let startAfter = 0;

  for (let page = 0; page < 50; page++) {
    let url = `${BASE}/contacts/?locationId=${LOCATION_ID()}&limit=100`;
    if (startAfterId)
      url += `&startAfterId=${startAfterId}&startAfter=${startAfter}`;

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

      // Pre-populate channel cache for ALL contacts we see
      if (c.id) {
        const campaign = cfs[MARKETING_CAMPAIGN_FIELD] || "";
        contactSourceCache.set(c.id, getChannel(c.source || "", campaign));
      }

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
    const lastCreated = new Date(
      contacts[contacts.length - 1].dateAdded
    ).getTime();
    if (lastCreated < JAN1_2026) break;
  }
  console.log(
    `Marketing: pre-cached ${contactSourceCache.size} contact channels from lead fetch`
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
        channel: getContactChannelCached(e.contactId || ""),
        cancelled,
        completed: !cancelled && endTime < now,
      });
    }
  }
  return appts;
}

async function fetchAllDeals(): Promise<DealRecord[]> {
  const deals: DealRecord[] = [];

  // A-B signed
  const tcRes = await fetch(
    `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${TC_PIPELINE}&limit=100`,
    { headers: getHeaders() }
  );
  if (tcRes.ok) {
    const tcData = await tcRes.json();
    for (const o of tcData.opportunities || []) {
      const d = new Date(o.createdAt).getTime();
      if (d < JAN1_2026) continue;
      const channel = o.contactId
        ? getContactChannelCached(o.contactId)
        : getChannel(o.source || "", "");
      deals.push({
        date: d,
        channel,
        category: "ab",
        monetaryValue: o.monetaryValue || 0,
      });
    }
  }

  // Closings from Mike/Josh closer pipelines
  const closerStages = [
    { pipeline: MIKE_PIPELINE, stage: "64d1fa71-6952-41cd-be5e-1536715b6d87" },
    { pipeline: JOSH_PIPELINE, stage: "0c4afc64-8163-4723-9f78-d4a0d7e1d037" },
  ];
  for (const q of closerStages) {
    const res = await fetch(
      `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${q.pipeline}&pipeline_stage_id=${q.stage}&limit=100`,
      { headers: getHeaders() }
    );
    if (!res.ok) continue;
    const data = await res.json();
    for (const o of data.opportunities || []) {
      const d = new Date(o.lastStageChangeAt).getTime();
      if (d < JAN1_2026) continue;
      const ch = o.contactId
        ? getContactChannelCached(o.contactId)
        : getChannel(o.source || "", "");
      deals.push({
        date: d,
        channel: ch,
        category: "closing",
        monetaryValue: o.monetaryValue || 0,
      });
    }
  }

  // Settled
  const DEALS_PIPELINE = "DiGXnGTlQCOMZQJmWQe9";
  const CLOSING_DATE_FIELD = "bbDP5pNJ96IMth9bQfh8";
  const settledRes = await fetch(
    `${BASE}/opportunities/search?location_id=${LOCATION_ID()}&pipeline_id=${DEALS_PIPELINE}&pipeline_stage_id=245bc5b3-e2ac-4886-8928-907560ec3f15&limit=100`,
    { headers: getHeaders() }
  );
  if (settledRes.ok) {
    const data = await settledRes.json();
    for (const o of data.opportunities || []) {
      // Fetch detail directly — no per-deal cache needed since the whole
      // payload is rebuilt only weekly via cron now.
      const detailRes = await fetch(`${BASE}/opportunities/${o.id}`, {
        headers: getHeaders(),
      });
      if (!detailRes.ok) continue;
      const detail = await detailRes.json();
      const opp = detail.opportunity || detail;
      const cfs: Record<string, string> = {};
      for (const cf of opp.customFields || []) {
        cfs[cf.id] = cf.fieldValue || cf.fieldValueString || "";
      }
      const closingDate = cfs[CLOSING_DATE_FIELD] || "";
      const monetaryValue = opp.monetaryValue || 0;

      if (!closingDate || closingDate < "2026") continue;
      const d = new Date(closingDate).getTime();
      if (d < JAN1_2026) continue;
      const ch = o.contactId
        ? getContactChannelCached(o.contactId)
        : getChannel(o.source || "", "");
      deals.push({ date: d, channel: ch, category: "settled", monetaryValue });
    }
  }

  return deals;
}

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

export interface MarketingData {
  weeks: MarketingWeekData[];
  channels: string[];
  lastUpdated: string;
}

export interface MarketingCachePayload {
  data: MarketingData;
  refreshedAt: string;
}

function buildWeekData(
  weeks: Week[],
  allLeads: LeadRecord[],
  allAppts: ApptRecord[],
  allDeals: DealRecord[]
): MarketingWeekData[] {
  return weeks.map((w) => {
    const channels: Record<string, ChannelWeekData> = {};
    for (const ch of CHANNELS) {
      const weekLeads = allLeads.filter(
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
    }
    return {
      weekKey: w.key,
      startDate: w.start.toISOString().slice(0, 10),
      endDate: w.end.toISOString().slice(0, 10),
      channels,
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
      if (manual) {
        channels[ch] = {
          ...channels[ch],
          spend: manual.spend || 0,
          mailersSent: manual.mailersSent || 0,
        };
      }
    }
    return { ...w, channels };
  });
}

export async function buildFreshMarketing(): Promise<MarketingData> {
  const weeks = getWeeks2026();

  contactSourceCache.clear();

  // Fetch leads first to populate channel cache, then appts+deals in parallel
  const allLeads = await fetchAllSellerLeads();
  const [allAppts, allDeals] = await Promise.all([
    fetchAllAppts(),
    fetchAllDeals(),
  ]);
  console.log(
    `Marketing: ${allLeads.length} leads, ${allAppts.length} appts, ${allDeals.length} deals (channel cache: ${contactSourceCache.size})`
  );

  const weekData = buildWeekData(weeks, allLeads, allAppts, allDeals);

  return {
    weeks: weekData,
    channels: CHANNELS as unknown as string[],
    lastUpdated: new Date().toISOString(),
  };
}

export const MARKETING_CHANNELS = CHANNELS;
