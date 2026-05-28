"use client";

import { useState, useEffect, useMemo } from "react";

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

interface ChannelMonthSplit {
  leads: number;
  appts: number;
  ab: number;
  closings: number;
  settled: number;
  grossProfit: number;
}
type MarketingMonthSplits = Record<string, Record<string, ChannelMonthSplit>>;

interface MarketingWeekData {
  weekKey: string;
  startDate: string;
  endDate: string;
  channels: Record<string, ChannelWeekData>;
  // Cross-month boundary weeks only — see api/marketing/builder.ts.
  monthSplits?: MarketingMonthSplits;
}

const CHANNEL_COLORS: Record<string, string> = {
  TV: "bg-yellow-500",
  PPC: "bg-blue-500",
  Mail: "bg-green-600",
  PPL: "bg-orange-500",
  Other: "bg-gray-500",
  SEO: "bg-purple-500",
};

// Channels surfaced on the dashboard. Unknown / Other / PPL are noise and
// hidden everywhere except in the YTD top-line totals (which keep summing
// across all channels for accuracy).
//
// GUARDRAIL 4: The actual visible list is DERIVED FROM THE API
// (data.channels with "Other" + "PPL" filtered out) so that a new channel
// can be added in the marketing builder without a page edit. The constant
// below is only the fallback for first paint before /api/marketing
// responds, and the source of truth for the typed CHANNEL_BAR_FILL map.
const FALLBACK_VISIBLE_CHANNELS = ["TV", "PPC", "Mail", "SEO", "Referral"] as const;
type VisibleChannel = typeof FALLBACK_VISIBLE_CHANNELS[number];

// Channels we hide from per-channel views regardless of what the API
// returns. Total YTD numbers still sum across them.
const HIDDEN_CHANNELS = new Set(["Other", "PPL", "Unknown"]);

function deriveVisibleChannels(apiChannels: string[]): string[] {
  const filtered = (apiChannels || []).filter((c) => !HIDDEN_CHANNELS.has(c));
  return filtered.length > 0 ? filtered : [...FALLBACK_VISIBLE_CHANNELS];
}

// Solid hex colors mirroring CHANNEL_COLORS — used for the inline horizontal
// bar fills in the Channel Comparison table.
const CHANNEL_BAR_FILL: Record<VisibleChannel, string> = {
  TV: "#eab308",        // yellow-500
  PPC: "#3b82f6",       // blue-500
  Mail: "#16a34a",      // green-600
  SEO: "#a855f7",       // purple-500
  Referral: "#14b8a6",  // teal-500
};

// Pill / badge color tokens for the YTD cost-per tiles. Match the
// /direct-mail page's segmentColor() pattern (light-bg + colored text +
// matching border) so the dashboards feel consistent.
const CHANNEL_BADGE: Record<string, string> = {
  TV: "bg-blue-100 text-blue-700 border-blue-200",
  PPC: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Mail: "bg-rose-100 text-rose-700 border-rose-200",
  SEO: "bg-amber-100 text-amber-700 border-amber-200",
  PPL: "bg-purple-100 text-purple-700 border-purple-200",
  Referral: "bg-teal-100 text-teal-700 border-teal-200",
  Other: "bg-gray-100 text-gray-700 border-gray-200",
};

const CHANNEL_LABELS: Record<string, string> = {
  TV: "TV",
  PPC: "PPC (Google Ads)",
  Mail: "Direct Mail",
  PPL: "PPL",
  Referral: "Referral",
  Other: "Unknown/Other",
  SEO: "SEO/Webleads",
};

const METRICS = [
  { key: "leads", label: "Leads" },
  { key: "spend", label: "Spend", fmt: "money", editable: true },
  { key: "appts", label: "Appts" },
  { key: "ab", label: "A-B" },
  { key: "closings", label: "Closings" },
  { key: "settled", label: "Settled" },
  { key: "grossProfit", label: "Profit", fmt: "money" },
];

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtMoney(v: number) { const n = Math.max(0, v); return n ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00"; }

// Whole-dollar money for the YTD cost-per tiles (mirrors /direct-mail's
// fmtMoney0). Returns "—" for non-finite or non-positive values so empty
// channels render as a dash instead of "$0".
function fmtMoney0(v: number) {
  if (!isFinite(v) || v <= 0) return "$0";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtCostPer(spend: number, count: number): string {
  if (!spend || !count) return "—";
  const v = spend / count;
  if (!isFinite(v) || v <= 0) return "—";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

// ROI as a multiplier (e.g. 1.74X), not a percent. Formula:
//   roi = grossProfit / spend  (when spend > 0)
// Color rule lives at the call-site so the same number can be themed
// for KPI tiles vs cards. Returns "—" when there is no spend so empty
// channels show a dash.
function fmtRoiX(grossProfit: number, spend: number): string {
  if (!spend || spend <= 0) return "—";
  const v = grossProfit / spend;
  if (!isFinite(v)) return "—";
  return `${v.toFixed(2)}X`;
}

const RefreshIcon = () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;

// Client-side cache
let mktCachedWeeks: MarketingWeekData[] | null = null;
let mktCachedChannels: string[] | null = null;
let mktCachedRefreshedAt = "";

function formatRefreshedAt(iso: string): string {
  if (!iso) return "never";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }) + " ET"
    );
  } catch {
    return iso;
  }
}

export default function MarketingPage() {
  const [weeks, setWeeks] = useState<MarketingWeekData[]>(mktCachedWeeks || []);
  const [channels, setChannels] = useState<string[]>(mktCachedChannels || []);
  const [loading, setLoading] = useState(!mktCachedWeeks);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState(mktCachedRefreshedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [editingCell, setEditingCell] = useState<{ weekKey: string; channel: string; metric: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const fetchData = () => {
    setLoading(true);
    setError("");
    fetch(`/api/marketing`)
      .then(async (r) => ({ status: r.status, json: await r.json() }))
      .then(({ status, json }) => {
        if (status === 503) {
          setError(
            json.error || "Marketing scorecard is refreshing — try again shortly."
          );
          setRefreshedAt(json.refreshedAt || "");
          mktCachedRefreshedAt = json.refreshedAt || "";
        } else if (json.error) {
          setError(json.error);
        } else {
          const w = json.weeks || [];
          const c = json.channels || [];
          const r = json.refreshedAt || json.lastUpdated || "";
          mktCachedWeeks = w;
          mktCachedChannels = c;
          mktCachedRefreshedAt = r;
          setWeeks(w);
          setChannels(c);
          setRefreshedAt(r);
        }
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (!mktCachedWeeks) fetchData(); }, []);

  async function manualRefresh() {
    const secret = window.prompt(
      "Enter CRON_SECRET to force a refresh (rebuilds from GHL — takes up to 60s):"
    );
    if (!secret) return;
    setRefreshing(true);
    setError("");
    try {
      const res = await fetch(
        `/api/marketing/refresh?secret=${encodeURIComponent(secret)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Refresh failed (${res.status})`);
        setRefreshing(false);
        return;
      }
      // Re-read the cache
      const reread = await fetch("/api/marketing").then((r) => r.json());
      const w = reread.weeks || [];
      const c = reread.channels || [];
      const r = reread.refreshedAt || reread.lastUpdated || "";
      mktCachedWeeks = w;
      mktCachedChannels = c;
      mktCachedRefreshedAt = r;
      setWeeks(w);
      setChannels(c);
      setRefreshedAt(r);
    } catch (err) {
      setError("Refresh failed: " + String(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function saveManualInput(weekKey: string, channel: string, metric: string, value: number) {
    setSaving(true);
    const body: Record<string, string | number> = { weekKey, channel };
    if (metric === "spend") body.spend = value;
    if (metric === "mailersSent") body.mailersSent = value;

    await fetch("/api/marketing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Update local state
    setWeeks((prev) =>
      prev.map((w) => {
        if (w.weekKey !== weekKey) return w;
        const ch = { ...w.channels[channel], [metric]: value };
        return { ...w, channels: { ...w.channels, [channel]: ch } };
      })
    );
    setSaving(false);
    setEditingCell(null);
  }

  // Compute totals per channel
  const channelTotals = useMemo(() => {
    const totals: Record<string, ChannelWeekData> = {};
    for (const ch of channels) {
      totals[ch] = { leads: 0, appts: 0, ab: 0, closings: 0, settled: 0, grossProfit: 0, spend: 0, mailersSent: 0 };
      for (const w of weeks) {
        const d = w.channels[ch];
        if (!d) continue;
        totals[ch].leads += d.leads;
        totals[ch].appts += d.appts;
        totals[ch].ab += d.ab;
        totals[ch].closings += d.closings;
        totals[ch].settled += d.settled;
        totals[ch].grossProfit += d.grossProfit;
        totals[ch].spend += d.spend;
        totals[ch].mailersSent += d.mailersSent;
      }
    }
    return totals;
  }, [weeks, channels]);

  // GUARDRAIL 4: derive the visible-channel list from the API response so
  // a new marketing channel (e.g. Referral, future "Door Knockers") shows
  // up on the dashboard without a code edit. Falls back to the constant
  // list on first paint before `channels` populates.
  const visibleChannels = useMemo(
    () => deriveVisibleChannels(channels),
    [channels]
  );

  // YTD totals across ALL channels — drives the wide snapshot card that
  // mirrors /direct-mail's "YTD 2026 Totals" tile band.
  const ytdAllTotals = useMemo(() => {
    let spend = 0,
      leads = 0,
      appts = 0,
      ab = 0,
      closings = 0,
      settled = 0,
      grossProfit = 0;
    for (const ch of Object.keys(channelTotals)) {
      const t = channelTotals[ch];
      spend += t.spend || 0;
      leads += t.leads || 0;
      appts += t.appts || 0;
      ab += t.ab || 0;
      closings += t.closings || 0;
      settled += t.settled || 0;
      grossProfit += t.grossProfit || 0;
    }
    return {
      spend,
      leads,
      appts,
      ab,
      closings,
      settled,
      grossProfit,
      avgCpl: leads > 0 ? spend / leads : 0,
      avgCpa: appts > 0 ? spend / appts : 0,
      // Avg cost per closing uses SETTLED (scorecard truth, 10 YTD), not
      // the closer-pipeline stage count which historically diverges.
      avgCpc: settled > 0 ? spend / settled : 0,
    };
  }, [channelTotals]);

  // Top-Line KPI computations:
  //   - Cost per Contract = YTD spend / YTD ab (contracts signed)
  //   - Cost per Closed Deal = YTD spend / YTD SETTLED (closing-date keyed,
  //     reconciles to scorecard's `settled` count of 10 — the prior
  //     `closings` field was Mike/Josh closer-pipeline stage count which
  //     diverges from scorecard truth).
  //   - Marketing ROI = grossProfit / spend  → multiplier (e.g. 1.74X)
  //   - Leads MTD vs prior month — uses week.startDate to bucket
  //   - Contracts Signed MTD = sum of ab across current calendar-month weeks
  const topLineKpis = useMemo(() => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth(); // 0-indexed
    const prevM = curM === 0 ? 11 : curM - 1;
    const prevY = curM === 0 ? curY - 1 : curY;

    let mtdLeads = 0;
    let prevMonthLeads = 0;
    let mtdContracts = 0;

    const MONTHS_LOWER = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];
    const curMonthName = MONTHS_LOWER[curM];
    const prevMonthName = MONTHS_LOWER[prevM];

    for (const w of weeks) {
      // weekKey/startDate is YYYY-MM-DD; parse without TZ shift
      const parts = (w.startDate || w.weekKey || "").split("-");
      if (parts.length !== 3) continue;
      const wy = parseInt(parts[0], 10);
      const wm = parseInt(parts[1], 10) - 1; // 0-indexed
      if (!isFinite(wy) || !isFinite(wm)) continue;

      // Parse end date too — if the week straddles the current/prev month
      // boundary we'll consume monthSplits for accurate MTD attribution.
      const endParts = (w.endDate || "").split("-");
      const ey = endParts.length === 3 ? parseInt(endParts[0], 10) : wy;
      const em = endParts.length === 3 ? parseInt(endParts[1], 10) - 1 : wm;
      const crossesMonth = isFinite(em) && (wy !== ey || wm !== em);
      const splits = w.monthSplits;

      // Helper — does any month in [start, end] match the target year+month?
      const weekTouches = (y: number, m: number): boolean => {
        if (!isFinite(em)) return wy === y && wm === m;
        if (wy === y && wm === m) return true;
        if (ey === y && em === m) return true;
        return false;
      };

      const inCur = weekTouches(curY, curM);
      const inPrev = weekTouches(prevY, prevM);
      if (!inCur && !inPrev) continue;

      for (const ch of Object.keys(w.channels || {})) {
        const d = w.channels[ch];
        if (!d) continue;
        if (crossesMonth && splits && splits[ch]) {
          // Use per-month split values when available.
          if (inCur) {
            const split = splits[ch][curMonthName];
            if (split) {
              mtdLeads += split.leads || 0;
              mtdContracts += split.ab || 0;
            }
          }
          if (inPrev) {
            const split = splits[ch][prevMonthName];
            if (split) {
              prevMonthLeads += split.leads || 0;
            }
          }
        } else {
          // Intra-month week: bucket whole-week into the start-month.
          if (inCur && wy === curY && wm === curM) {
            mtdLeads += d.leads || 0;
            mtdContracts += d.ab || 0;
          }
          if (inPrev && wy === prevY && wm === prevM) {
            prevMonthLeads += d.leads || 0;
          }
        }
      }
    }

    const spend = ytdAllTotals.spend;
    const ab = ytdAllTotals.ab;
    // Closings = settled (closing-date keyed) so this denominator
    // matches scorecard truth (10 YTD), not the closer-pipeline count.
    const closings = ytdAllTotals.settled;
    const gp = ytdAllTotals.grossProfit;

    const costPerContract = ab > 0 ? spend / ab : 0;
    const costPerClosed = closings > 0 ? spend / closings : 0;
    // ROI as multiplier — gross profit / spend.
    const roiX = spend > 0 ? gp / spend : 0;

    const leadsDelta = mtdLeads - prevMonthLeads;
    const leadsPctChange =
      prevMonthLeads > 0
        ? ((mtdLeads - prevMonthLeads) / prevMonthLeads) * 100
        : 0;

    return {
      costPerContract,
      hasContracts: ab > 0,
      costPerClosed,
      hasClosings: closings > 0,
      roiX,
      hasSpend: spend > 0,
      mtdLeads,
      prevMonthLeads,
      leadsDelta,
      leadsPctChange,
      hasPrevLeads: prevMonthLeads > 0,
      mtdContracts,
    };
  }, [weeks, ytdAllTotals]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-500 font-medium">Building marketing scorecard...</p>
        </div>
      </div>
    );
  }

  function renderValue(week: MarketingWeekData, ch: string, metric: typeof METRICS[0]) {
    const data = week.channels[ch];
    if (!data) return "—";
    const val = (data as unknown as Record<string, number>)[metric.key] || 0;

    // Editable cell
    if (metric.editable) {
      const isEditing = editingCell?.weekKey === week.weekKey && editingCell?.channel === ch && editingCell?.metric === metric.key;
      if (isEditing) {
        return (
          <input type="number" value={editValue} autoFocus
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => saveManualInput(week.weekKey, ch, metric.key, parseFloat(editValue) || 0)}
            onKeyDown={(e) => { if (e.key === "Enter") saveManualInput(week.weekKey, ch, metric.key, parseFloat(editValue) || 0); if (e.key === "Escape") setEditingCell(null); }}
            className="w-20 px-1 py-0.5 text-xs border border-blue-400 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        );
      }
      return (
        <button onClick={() => { setEditingCell({ weekKey: week.weekKey, channel: ch, metric: metric.key }); setEditValue(String(val || "")); }}
          className={`cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded ${val > 0 ? "text-gray-900" : "text-gray-300"}`}
          title="Click to edit">
          {metric.fmt === "money" ? fmtMoney(val) : (val || "—")}
        </button>
      );
    }

    if (metric.fmt === "money") return fmtMoney(val);
    return val || 0;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-60 flex-shrink-0 flex flex-col transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`} style={{ background: "#1a1f36" }}>
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </div>
            <div><h1 className="text-white font-bold text-sm leading-tight">Impact Home</h1><p className="text-blue-300 text-xs">Marketing</p></div>
            <button className="ml-auto lg:hidden text-gray-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {/* Ops Scorecard parent */}
          <a href="/scorecard" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Ops Scorecard
          </a>
          <a href="/call-dashboard" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            Calls
          </a>

          {/* Marketing parent (active) */}
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-white/10 text-white mt-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /><path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" /></svg>
            Marketing
          </button>
          <a href="/direct-mail" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 0v10a2 2 0 002 2h14a2 2 0 002-2V8m-18 0l9-5 9 5" /></svg>
            Direct Mail
          </a>
          <a href="/google-ads" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            Google Ads
          </a>
          <a href="/seo" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            SEO
          </a>
          <a href="/tv" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="5" width="18" height="13" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 18v3" /></svg>
            TV
          </a>
        </nav>
        <div className="p-4 border-t border-white/10"><p className="text-gray-500 text-xs text-center">Impact Home Team &copy; 2026</p></div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100" onClick={() => setSidebarOpen(true)}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div>
            <h2 className="text-lg font-bold text-gray-900">2026 Marketing Scorecard</h2>
            <p className="text-sm text-gray-500 hidden sm:block">
              Channel performance by week &middot; Click spend/mailer cells to edit
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Last refreshed: <span className="font-medium text-gray-700">{formatRefreshedAt(refreshedAt)}</span>
              <span className="ml-2 text-gray-400">(weekly cron Mon 6 AM ET)</span>
            </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saving && <span className="text-blue-500 text-xs animate-pulse">Saving...</span>}
            {refreshing && <span className="text-blue-500 text-xs animate-pulse">Refreshing from GHL...</span>}
            {error && <span className="text-red-500 text-xs">{error}</span>}
            <button
              onClick={manualRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-gray-900 text-xs font-medium transition disabled:opacity-50"
              title="Force refresh from GHL (admin only)"
            >
              <RefreshIcon />
              <span className="hidden sm:inline">Refresh now</span>
            </button>
          </div>
        </header>

        <div className="p-4 sm:p-6 space-y-6">
          {/* ── Top-Line KPIs ──────────────────────────────────────
              5-second glance row: cost per contract, cost per closing,
              ROI, leads MTD vs last month, contracts MTD. Mirrors the
              YTD Snapshot card chrome (rounded-xl shadow-sm border). */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Top-Line KPIs
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              5-second glance — Cost per contract &amp; closing, ROI, leads MTD
              vs last, contracts MTD.
            </p>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* 1. Cost per Contract */}
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Cost per Contract
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {topLineKpis.hasContracts
                      ? fmtMoney0(topLineKpis.costPerContract)
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    YTD spend ÷ contracts
                  </p>
                </div>

                {/* 2. Cost per Closed Deal */}
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Cost / Closed Deal
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {topLineKpis.hasClosings
                      ? fmtMoney0(topLineKpis.costPerClosed)
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    YTD spend ÷ closings
                  </p>
                </div>

                {/* 3. Marketing ROI — multiplier format (e.g. 1.74X). Green
                    when ≥ 1.0X (profitable), red when < 1.0X (losing money),
                    gray when no spend. */}
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Marketing ROI
                  </p>
                  <p
                    className={`text-lg font-bold mt-1 ${
                      !topLineKpis.hasSpend
                        ? "text-gray-900"
                        : topLineKpis.roiX >= 1
                          ? "text-emerald-600"
                          : "text-rose-600"
                    }`}
                  >
                    {topLineKpis.hasSpend
                      ? `${topLineKpis.roiX.toFixed(2)}X`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Gross Profit ÷ Spend
                  </p>
                </div>

                {/* 4. Leads MTD vs Last Month */}
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Leads MTD vs Last
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1 flex items-baseline gap-1.5">
                    <span>{topLineKpis.mtdLeads.toLocaleString()}</span>
                    {topLineKpis.hasPrevLeads && (
                      <span
                        className={`text-xs font-semibold ${
                          topLineKpis.leadsDelta > 0
                            ? "text-emerald-600"
                            : topLineKpis.leadsDelta < 0
                              ? "text-rose-600"
                              : "text-gray-500"
                        }`}
                      >
                        {topLineKpis.leadsDelta > 0
                          ? "↑"
                          : topLineKpis.leadsDelta < 0
                            ? "↓"
                            : ""}{" "}
                        {Math.abs(
                          Math.round(topLineKpis.leadsPctChange),
                        ).toLocaleString("en-US")}
                        %
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {topLineKpis.hasPrevLeads
                      ? `vs ${topLineKpis.prevMonthLeads.toLocaleString()} prior month`
                      : "no prior-month leads"}
                  </p>
                </div>

                {/* 5. Contracts Signed MTD */}
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Contracts Signed MTD
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {topLineKpis.mtdContracts.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Current calendar month
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── YTD Channel Cost Cards ──────────────────────────
              Source: spend pulled from '2026 Marketing Scorecard'
              cols I/O/U via bcdi-api → Vercel KV → /api/marketing.
              Filtered to visibleChannels only (derived from API minus
              Other/PPL) — the Unknown/Other/PPL noise channels are hidden
              from per-channel displays. ROI is the headline metric. */}
          {(() => {
            const visible = visibleChannels.filter((ch) => {
              const t = channelTotals[ch];
              if (!t) return false;
              return (t.spend || 0) > 0 || (t.leads || 0) > 0;
            });
            if (visible.length === 0) return null;
            return (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                  YTD Channel Performance
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {visible.map((ch) => {
                    const t = channelTotals[ch];
                    const badge =
                      CHANNEL_BADGE[ch] ||
                      "bg-gray-100 text-gray-700 border-gray-200";
                    const hasSpend = (t.spend || 0) > 0;
                    // ROI as multiplier — gross profit / spend. Green at
                    // ≥ 1.0X (profitable), red below.
                    const roiX = hasSpend ? t.grossProfit / t.spend : 0;
                    const roiColor = !hasSpend
                      ? "text-gray-900"
                      : roiX >= 1
                        ? "text-emerald-600"
                        : "text-rose-600";
                    return (
                      <div
                        key={`tile-${ch}`}
                        className="bg-white rounded-xl shadow-sm border border-gray-100 p-4"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badge}`}
                          >
                            {CHANNEL_LABELS[ch] || ch}
                          </span>
                          <span className="text-xs text-gray-400">YTD</span>
                        </div>
                        <div className="flex items-baseline gap-1 mb-3">
                          <span className="text-2xl font-bold text-emerald-600">
                            {fmtMoney0(t.grossProfit)}
                          </span>
                          <span className="text-sm text-gray-400">revenue</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-3 text-center border-t border-gray-100 pt-3">
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
                              Leads
                            </p>
                            <p className="text-sm font-semibold text-gray-900">
                              {t.leads.toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
                              Appts
                            </p>
                            <p className="text-sm font-semibold text-gray-900">
                              {t.appts.toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider">
                              Closings
                            </p>
                            <p className="text-sm font-semibold text-gray-900">
                              {t.settled.toLocaleString()}
                            </p>
                          </div>
                        </div>
                        {/* Big ROI headline — colored green/red so the user
                            sees profitability at a glance. */}
                        <div className="border-t border-gray-100 pt-3 mb-2">
                          <div className="flex items-baseline justify-between">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                              ROI
                            </p>
                            <p
                              className={`text-2xl font-extrabold leading-none ${roiColor}`}
                            >
                              {hasSpend ? `${roiX.toFixed(2)}X` : "—"}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1.5 border-t border-gray-100 pt-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Cost / Lead</span>
                            <span className="font-semibold text-gray-900">
                              {fmtCostPer(t.spend, t.leads)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Cost / Appt</span>
                            <span className="font-semibold text-gray-900">
                              {fmtCostPer(t.spend, t.appts)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">
                              Cost / Closing
                            </span>
                            <span className="font-semibold text-gray-900">
                              {fmtCostPer(t.spend, t.settled)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Spend</span>
                            <span className="font-semibold text-gray-900">
                              {fmtMoney0(t.spend)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">CAC</span>
                            <span className="font-semibold text-gray-900">
                              {fmtCostPer(t.spend, t.settled)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* ── Channel Comparison Table ────────────────────────────
              Replacement for the donuts that used to live on /scorecard.
              Horizontal-bar style — one row per VISIBLE_CHANNEL, four
              metric columns (Leads / Appts / A-B / Closings). Bar widths
              are scaled to the column max so the eye reads relative
              performance immediately. */}
          {(() => {
            const visible = visibleChannels.filter((ch) => channelTotals[ch]);
            if (visible.length === 0) return null;

            const maxOf = (key: "leads" | "appts" | "ab" | "settled") =>
              Math.max(
                1,
                ...visible.map((c) => channelTotals[c]?.[key] || 0),
              );
            const maxes = {
              leads: maxOf("leads"),
              appts: maxOf("appts"),
              ab: maxOf("ab"),
              settled: maxOf("settled"),
            };

            const renderBar = (
              ch: string,
              key: "leads" | "appts" | "ab" | "settled",
            ) => {
              const v = channelTotals[ch]?.[key] || 0;
              const pct = Math.round((v / maxes[key]) * 100);
              const fill =
                CHANNEL_BAR_FILL[ch as VisibleChannel] || "#9ca3af";
              return (
                <div className="flex items-center gap-2 min-w-[140px]">
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: fill }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-900 w-8 text-right tabular-nums">
                    {v.toLocaleString()}
                  </span>
                </div>
              );
            };

            return (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  Channel Comparison
                </h3>
                <p className="text-xs text-gray-500 mb-3">
                  YTD volume per channel — bar widths are relative to the
                  column max so you can read winners at a glance.
                </p>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2.5 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">
                            Channel
                          </th>
                          <th className="px-4 py-2.5 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">
                            Leads
                          </th>
                          <th className="px-4 py-2.5 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">
                            Appts
                          </th>
                          <th className="px-4 py-2.5 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">
                            A-B Signed
                          </th>
                          <th className="px-4 py-2.5 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">
                            Closings
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((ch) => (
                          <tr
                            key={`cmp-${ch}`}
                            className="border-b border-gray-50 hover:bg-gray-50/50"
                          >
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                                  CHANNEL_BADGE[ch] ||
                                  "bg-gray-100 text-gray-700 border-gray-200"
                                }`}
                              >
                                {CHANNEL_LABELS[ch] || ch}
                              </span>
                            </td>
                            <td className="px-4 py-3">{renderBar(ch, "leads")}</td>
                            <td className="px-4 py-3">{renderBar(ch, "appts")}</td>
                            <td className="px-4 py-3">{renderBar(ch, "ab")}</td>
                            <td className="px-4 py-3">{renderBar(ch, "settled")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* ── YTD Snapshot Wide Card ─────────────────────────────
              Mirrors /direct-mail's "YTD 2026 Totals" tile band: 8 KPI
              tiles in a single white card. Sums all channels across
              the YTD weekly grid. */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
              YTD 2026 Snapshot
            </h3>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Total Spend
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {fmtMoney0(ytdAllTotals.spend)}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Total Leads
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {ytdAllTotals.leads.toLocaleString()}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Appointments
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {ytdAllTotals.appts.toLocaleString()}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Contracts
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {ytdAllTotals.ab.toLocaleString()}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Closings
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {ytdAllTotals.settled.toLocaleString()}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Avg CPL
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {ytdAllTotals.avgCpl > 0
                      ? `$${Math.round(ytdAllTotals.avgCpl).toLocaleString("en-US")}`
                      : "—"}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Avg CPA
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {ytdAllTotals.avgCpa > 0
                      ? `$${Math.round(ytdAllTotals.avgCpa).toLocaleString("en-US")}`
                      : "—"}
                  </p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Avg CPC
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {ytdAllTotals.avgCpc > 0
                      ? `$${Math.round(ytdAllTotals.avgCpc).toLocaleString("en-US")}`
                      : "—"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Weekly grid — restricted to visibleChannels (API-derived, minus
              Other/PPL) so the noisy Unknown / Other / PPL columns no
              longer crowd the table. The full set still drives top-line
              totals (ytdAllTotals) for accuracy. */}
          {(() => {
            // GUARDRAIL 4: visibleChannels is derived from the API at the
            // component level via deriveVisibleChannels(). No local
            // re-filtering needed here — the outer memoized list IS the
            // grid's column list.
            return (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  {/* Channel group headers */}
                  <tr>
                    <th className="bg-gray-700 text-white px-3 py-2 text-xs font-semibold sticky left-0 z-10" rowSpan={2}>Week</th>
                    {visibleChannels.map((ch) => {
                      const metricsForChannel = METRICS;
                      return (
                        <th key={ch} colSpan={metricsForChannel.length}
                          className={`${CHANNEL_COLORS[ch] || "bg-gray-500"} text-white text-center px-2 py-2 font-semibold text-xs uppercase tracking-wider border-l-2 border-white/30`}>
                          {CHANNEL_LABELS[ch] || ch}
                        </th>
                      );
                    })}
                  </tr>
                  {/* Metric sub-headers */}
                  <tr className="bg-gray-50">
                    {visibleChannels.map((ch) =>
                      METRICS.map((m) => (
                        <th key={`${ch}-${m.key}`} className="px-2 py-1.5 font-medium text-gray-500 text-[10px] whitespace-nowrap border-r border-gray-100 text-center">
                          {m.label}
                        </th>
                      ))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={week.weekKey} className="hover:bg-blue-50/30 transition border-b border-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700 font-medium sticky left-0 bg-white z-[5] border-r border-gray-100">
                        {fmtDate(week.startDate)} - {fmtDate(week.endDate)}
                      </td>
                      {visibleChannels.map((ch) =>
                        METRICS.map((m) => (
                          <td key={`${week.weekKey}-${ch}-${m.key}`}
                            className={`px-2 py-1.5 text-center whitespace-nowrap border-r border-gray-50 ${m.editable ? "bg-yellow-50/50" : ""}`}>
                            {renderValue(week, ch, m)}
                          </td>
                        ))
                      )}
                    </tr>
                  ))}

                  {/* Totals row */}
                  <tr className="bg-emerald-50 border-t-2 border-emerald-300 font-bold">
                    <td className="px-3 py-2 text-emerald-900 sticky left-0 bg-emerald-50 z-[5] border-r border-emerald-100">2026 Total</td>
                    {visibleChannels.map((ch) =>
                      METRICS.map((m) => {
                        const t = channelTotals[ch];
                        if (!t) return <td key={`tot-${ch}-${m.key}`} className="px-2 py-1.5 text-center border-r border-emerald-100">0</td>;
                        const val = (t as unknown as Record<string, number>)[m.key] || 0;
                        return (
                          <td key={`tot-${ch}-${m.key}`} className="px-2 py-1.5 text-center text-emerald-900 border-r border-emerald-100">
                            {m.fmt === "money" ? fmtMoney(val) : val}
                          </td>
                        );
                      })
                    )}
                  </tr>

                  {/* ROI row — multiplier (e.g. 1.74X) so 1.0X is the
                      breakeven line at a glance. */}
                  <tr className="bg-blue-50 border-t border-blue-200 font-bold">
                    <td className="px-3 py-2 text-blue-900 sticky left-0 bg-blue-50 z-[5] border-r border-blue-100">ROI</td>
                    {visibleChannels.map((ch) =>
                      METRICS.map((m, idx) => {
                        const t = channelTotals[ch];
                        if (idx === 0 && t) {
                          return (
                            <td key={`roi-${ch}-${m.key}`} className="px-2 py-1.5 text-center text-blue-900 border-r border-blue-100" colSpan={METRICS.length}>
                              {fmtRoiX(t.grossProfit, t.spend)}
                            </td>
                          );
                        }
                        return null;
                      }).filter(Boolean)
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
            );
          })()}
        </div>
      </main>
    </div>
  );
}
