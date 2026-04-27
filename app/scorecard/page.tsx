"use client";

import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

// Client-side cache to prevent re-fetch on every tab switch
let cachedWeeks: WeekData[] | null = null;
let cachedRefreshedAt = "";

interface SourceBreakdown { [source: string]: number; }

interface MonthSplit {
  settled: number;
  grossProfit: number;
  abSigned: number;
  inPersonOffers: number;
  virtualOffers: number;
}
type MonthSplits = Record<string, MonthSplit>;

// Metrics that get re-attributed by each event's actual date when a week
// straddles a month boundary. Everything else stays bucketed by week-start.
const MONTH_SPLIT_KEYS = [
  "settled",
  "grossProfit",
  "abSigned",
  "inPersonOffers",
  "virtualOffers",
] as const;

interface WeekData {
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
  mikeAppts: number; mikeOffers: number; mikeSigned: number; mikeSettled: number;
  joshAppts: number; joshOffers: number; joshSigned: number; joshSettled: number;
  // Cross-month boundary weeks carry per-month splits for the date-anchored
  // metrics so e.g. a deal closed 4/3 in week 3/30–4/5 lands in April, not
  // March. Set by the scorecard builder; absent on intra-month weeks.
  monthSplits?: MonthSplits;
}

type ColFmt = (v: number | string) => string;

function fmtDate(v: number | string) {
  const iso = String(v);
  // Only attempt date parsing on YYYY-MM-DD-shaped strings; anything else
  // (labels like "Apr 2026", "Total", "Avg/Week", "Q1 2026") returns verbatim.
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return String(v);
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function fmtPct(v: number | string) { const n = Number(v); return n ? `${n.toFixed(1)}%` : "0%"; }
function fmtDur(v: number | string) { const s = Number(v); const m = Math.floor(s / 60), r = s % 60; return m ? `${m}m ${r}s` : `${r}s`; }
function fmtMoney(v: number | string) { const n = Math.max(0, Number(v)); return n ? `$${n.toLocaleString()}` : "$0"; }

interface Column { key: string; label: string; fmt?: ColFmt; }

const COLUMN_GROUPS: { label: string; color: string; columns: Column[] }[] = [
  { label: "Week", color: "bg-gray-700", columns: [
    { key: "startDate", label: "Start", fmt: fmtDate },
    { key: "endDate", label: "End", fmt: fmtDate },
  ]},
  { label: "Calls", color: "bg-blue-600", columns: [
    { key: "dials", label: "Dials" },
    { key: "totalInbound", label: "Inbound" },
    { key: "pickUpRate", label: "Pick Up %", fmt: fmtPct },
    { key: "missedCalls", label: "Missed" },
    { key: "connects", label: "Connects" },
    { key: "avgCallDuration", label: "Avg Dur", fmt: fmtDur },
    { key: "connectRate", label: "Connect %", fmt: fmtPct },
  ]},
  { label: "Leads", color: "bg-emerald-600", columns: [
    { key: "leads", label: "Leads" },
    { key: "prospects", label: "Prospects" },
    { key: "bookingPct", label: "Book %", fmt: fmtPct },
  ]},
  { label: "Appointments", color: "bg-amber-600", columns: [
    { key: "inPersonBooked", label: "IP Book" },
    { key: "virtualBooked", label: "V Book" },
    { key: "cancelledInPerson", label: "Canc IP" },
    { key: "cancelledVirtual", label: "Canc V" },
    { key: "inPersonCompleted", label: "IP Done" },
    { key: "virtualCompleted", label: "V Done" },
    { key: "showRateInPerson", label: "Show% IP", fmt: fmtPct },
    { key: "showRateVirtual", label: "Show% V", fmt: fmtPct },
  ]},
  { label: "Offers & Deals", color: "bg-purple-600", columns: [
    { key: "inPersonOffers", label: "IP Offers" },
    { key: "virtualOffers", label: "V Offers" },
    { key: "abSigned", label: "A-B" },
    { key: "bcSigned", label: "B-C" },
    { key: "settled", label: "Settled" },
    { key: "grossProfit", label: "Profit", fmt: fmtMoney },
  ]},
];

const allColumns = COLUMN_GROUPS.flatMap((g) => g.columns);

// Drilldown modal
function DrilldownModal({ title, data, onClose }: { title: string; data: Record<string, number>; onClose: () => void }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100"><th className="text-left py-2 text-gray-500">Source</th><th className="text-right py-2 text-gray-500">Count</th><th className="text-right py-2 text-gray-500">%</th></tr></thead>
          <tbody>
            {entries.map(([source, count]) => (
              <tr key={source} className="border-b border-gray-50">
                <td className="py-2 text-gray-800">{source || "Unknown"}</td>
                <td className="py-2 text-right font-medium">{count}</td>
                <td className="py-2 text-right text-gray-500">{total > 0 ? Math.round((count / total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-gray-200"><td className="py-2 font-bold">Total</td><td className="py-2 text-right font-bold">{total}</td><td className="py-2 text-right font-bold">100%</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

function sumField(weeks: WeekData[], key: string): number {
  return weeks.reduce((a, w) => a + ((w as unknown as Record<string, number>)[key] || 0), 0);
}

function avgField(weeks: WeekData[], key: string): number {
  const n = weeks.length || 1;
  return Math.round(sumField(weeks, key) / n * 100) / 100;
}

function buildSummaryRow(label: string, subset: WeekData[]): Record<string, number | string> {
  const row: Record<string, number | string> = { startDate: label, endDate: "" };
  for (const col of allColumns) {
    if (col.key === "startDate" || col.key === "endDate") continue;
    if (col.key.includes("Rate") || col.key.includes("Pct") || col.key === "pickUpRate" || col.key === "bookingPct") {
      const vals = subset.map((w) => (w as unknown as Record<string, number>)[col.key]).filter((v) => v > 0);
      row[col.key] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : 0;
    } else if (col.key === "avgCallDuration") {
      const vals = subset.map((w) => w.avgCallDuration).filter((v) => v > 0);
      row[col.key] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    } else {
      row[col.key] = sumField(subset, col.key);
    }
  }
  return row;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const RefreshIcon = () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;

function formatRefreshedAt(iso: string): string {
  if (!iso) return "never";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " ET";
  } catch {
    return iso;
  }
}

export default function ScorecardPage() {
  const [weeks, setWeeks] = useState<WeekData[]>(cachedWeeks || []);
  const [drilldown, setDrilldown] = useState<{ title: string; data: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(!cachedWeeks);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState(cachedRefreshedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (cachedWeeks) return; // Already have data, skip fetch
    fetch("/api/scorecard")
      .then(async (r) => ({ status: r.status, json: await r.json() }))
      .then(({ status, json }) => {
        if (status === 503) {
          setError(json.error || "Scorecard is refreshing — try again shortly.");
          setRefreshedAt(json.refreshedAt || "");
          cachedRefreshedAt = json.refreshedAt || "";
        } else if (json.error) {
          setError(json.error);
        } else {
          const w = json.weeks || [];
          const r = json.refreshedAt || json.lastUpdated || "";
          cachedWeeks = w;
          cachedRefreshedAt = r;
          setWeeks(w);
          setRefreshedAt(r);
        }
      })
      .catch(() => setError("Failed to load scorecard"))
      .finally(() => setLoading(false));
  }, []);

  async function manualRefresh() {
    const secret = window.prompt(
      "Enter CRON_SECRET to force a refresh (rebuilds from GHL — takes up to 60s):"
    );
    if (!secret) return;
    setRefreshing(true);
    setError("");
    try {
      const res = await fetch(
        `/api/scorecard/refresh?secret=${encodeURIComponent(secret)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Refresh failed (${res.status})`);
        setRefreshing(false);
        return;
      }
      // Re-read the cache
      const reread = await fetch("/api/scorecard").then((r) => r.json());
      const w = reread.weeks || [];
      const r = reread.refreshedAt || reread.lastUpdated || "";
      cachedWeeks = w;
      cachedRefreshedAt = r;
      setWeeks(w);
      setRefreshedAt(r);
    } catch (err) {
      setError("Refresh failed: " + String(err));
    } finally {
      setRefreshing(false);
    }
  }

  // Monthly summaries — bucket each week into its start month, BUT when a
  // week crosses a month boundary (carries `monthSplits`), partition the
  // date-anchored metrics by their actual close/sign date so e.g. a deal
  // closed 4/3 in week 3/30–4/5 lands in April, not March.
  //
  // Mechanism: for every cross-boundary week we contribute (a) a copy with
  // start-month split metrics to its start-month bucket and (b) a "ghost"
  // copy with end-month split metrics + everything else zeroed to its
  // end-month bucket. That way `buildSummaryRow`'s `sumField` over each
  // bucket totals correctly without double-counting.
  const monthlySummaries = useMemo(() => {
    const byMonth: Record<number, WeekData[]> = {};
    const monthIdxFromName = (name: string): number =>
      MONTHS.findIndex((m) => m.toLowerCase() === name.toLowerCase());
    const zeroSplit = (): MonthSplit => ({
      settled: 0,
      grossProfit: 0,
      abSigned: 0,
      inPersonOffers: 0,
      virtualOffers: 0,
    });
    weeks.forEach((w) => {
      const startIdx = new Date(w.startDate + "T00:00:00").getMonth();
      const splits = w.monthSplits;
      if (!splits) {
        if (!byMonth[startIdx]) byMonth[startIdx] = [];
        byMonth[startIdx].push(w);
        return;
      }
      // Cross-month week. Build per-month contributions.
      // Start-month copy: keep all non-split metrics intact, override split
      // metrics with the start-month's portion (zero if not present).
      const startMonthName = MONTHS[startIdx].toLowerCase();
      const startSplit = splits[startMonthName] || zeroSplit();
      const startCopy: WeekData = { ...w };
      for (const k of MONTH_SPLIT_KEYS) {
        (startCopy as unknown as Record<string, number>)[k] = startSplit[k];
      }
      // Drop monthSplits on the copies so downstream code can't loop.
      delete startCopy.monthSplits;
      if (!byMonth[startIdx]) byMonth[startIdx] = [];
      byMonth[startIdx].push(startCopy);

      // For every other month present in splits, push a ghost week containing
      // ONLY that month's split metrics — everything else zeroed so it
      // doesn't double-count call/lead/appt totals.
      for (const monthName of Object.keys(splits)) {
        if (monthName === startMonthName) continue;
        const otherIdx = monthIdxFromName(monthName);
        if (otherIdx < 0) continue;
        const split = splits[monthName] || zeroSplit();
        // Build a ghost week from the original shape with all numeric fields
        // zeroed, then overlay the split metrics for this month.
        const ghost: Record<string, number | string | SourceBreakdown | MonthSplits | undefined> = {};
        for (const key of Object.keys(w)) {
          const val = (w as unknown as Record<string, unknown>)[key];
          if (typeof val === "number") ghost[key] = 0;
          else if (typeof val === "string") ghost[key] = val;
          else ghost[key] = undefined;
        }
        for (const k of MONTH_SPLIT_KEYS) {
          ghost[k] = split[k];
        }
        delete ghost.monthSplits;
        if (!byMonth[otherIdx]) byMonth[otherIdx] = [];
        byMonth[otherIdx].push(ghost as unknown as WeekData);
      }
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([m, ws]) => ({ label: MONTHS[parseInt(m)], ...buildSummaryRow(MONTHS[parseInt(m)], ws) }));
  }, [weeks]);

  const q1Summary = useMemo(() => {
    const q1 = weeks.filter((w) => { const m = new Date(w.startDate + "T00:00:00").getMonth(); return m < 3; });
    return buildSummaryRow("Q1 2026", q1);
  }, [weeks]);

  const ytdSummary = useMemo(() => buildSummaryRow("YTD 2026", weeks), [weeks]);
  const ytdAvg = useMemo(() => {
    const row = buildSummaryRow("Avg/Week", weeks);
    for (const col of allColumns) {
      if (col.key === "startDate" || col.key === "endDate") continue;
      if (!col.key.includes("Rate") && !col.key.includes("Pct") && col.key !== "pickUpRate" && col.key !== "bookingPct" && col.key !== "avgCallDuration") {
        row[col.key] = avgField(weeks, col.key);
      }
    }
    return row;
  }, [weeks]);

  // Mike vs Josh leaderboard
  const leaderboard = useMemo(() => ({
    mike: { appts: sumField(weeks, "mikeAppts"), offers: sumField(weeks, "mikeOffers"), signed: sumField(weeks, "mikeSigned"), settled: sumField(weeks, "mikeSettled") },
    josh: { appts: sumField(weeks, "joshAppts"), offers: sumField(weeks, "joshOffers"), signed: sumField(weeks, "joshSigned"), settled: sumField(weeks, "joshSettled") },
  }), [weeks]);

  // Chart data
  const chartData = useMemo(() => weeks.map((w) => ({
    week: fmtDate(w.startDate),
    Leads: w.leads,
    Connects: w.connects,
    "IP Appts": w.inPersonCompleted,
    "V Appts": w.virtualCompleted,
    "A-B": w.abSigned,
    Settled: w.settled,
  })), [weeks]);

  // Channel breakdowns (Leads/Appts/A-B by Channel) used to render here as
  // donut charts. Moved to /marketing as a horizontal "Channel Comparison"
  // table to fix label-collision illegibility on the scorecard.

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-500 font-medium">Building scorecard from GHL data...</p>
        </div>
      </div>
    );
  }

  function renderCell(row: Record<string, number | string>, col: Column, isSummary = false, weekIdx?: number) {
    const val = row[col.key];
    if (col.key === "startDate" || col.key === "endDate") {
      return <span className={isSummary ? "font-bold text-gray-900" : "text-gray-700"}>{col.fmt ? col.fmt(val) : val}</span>;
    }
    const display = col.fmt ? col.fmt(val) : Number(val).toLocaleString();
    const num = Number(val);

    // Clickable drilldowns
    if (!isSummary && weekIdx !== undefined && num > 0) {
      const week = weeks[weekIdx];
      if (col.key === "leads" && week?.leadsBySource) {
        return <button onClick={() => setDrilldown({ title: `Leads - ${fmtDate(week.startDate)}`, data: week.leadsBySource })} className="text-blue-600 hover:text-blue-800 underline font-medium">{display}</button>;
      }
      if ((col.key === "inPersonBooked" || col.key === "virtualBooked" || col.key === "inPersonCompleted" || col.key === "virtualCompleted") && week?.apptsBySource) {
        return <button onClick={() => setDrilldown({ title: `Appointments - ${fmtDate(week.startDate)}`, data: week.apptsBySource })} className="text-blue-600 hover:text-blue-800 underline font-medium">{display}</button>;
      }
      if (col.key === "abSigned" && week?.abBySource) {
        return <button onClick={() => setDrilldown({ title: `A-B Signed - ${fmtDate(week.startDate)}`, data: week.abBySource })} className="text-blue-600 hover:text-blue-800 underline font-medium">{display}</button>;
      }
      if (col.key === "settled" && week?.settledBySource) {
        return <button onClick={() => setDrilldown({ title: `Settled - ${fmtDate(week.startDate)}`, data: week.settledBySource })} className="text-blue-600 hover:text-blue-800 underline font-medium">{display}</button>;
      }
    }

    return <span className={isSummary ? "font-bold" : ""}>{display}</span>;
  }

  function SummaryRow({ row, className }: { row: Record<string, number | string>; className: string }) {
    return (
      <tr className={className}>
        {allColumns.map((col) => (
          <td key={col.key} className="px-3 py-2 whitespace-nowrap text-center border-r border-inherit font-bold">
            {renderCell(row, col, true)}
          </td>
        ))}
      </tr>
    );
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
            <div><h1 className="text-white font-bold text-sm leading-tight">Impact Home</h1><p className="text-blue-300 text-xs">Operations</p></div>
            <button className="ml-auto lg:hidden text-gray-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <a href="/call-dashboard" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            Call Dashboard
          </a>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-white/10 text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Ops Scorecard
          </button>
          <a href="/marketing" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /><path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" /></svg>
            Marketing
          </a>
          <a href="/direct-mail" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 0v10a2 2 0 002 2h14a2 2 0 002-2V8m-18 0l9-5 9 5" /></svg>
            Direct Mail
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
            <h2 className="text-lg font-bold text-gray-900">2026 Operations Scorecard</h2>
            <p className="text-sm text-gray-500 hidden sm:block">
              Weekly KPIs &middot; {weeks.length} weeks &middot; Click numbers for source breakdown
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Last refreshed: <span className="font-medium text-gray-700">{formatRefreshedAt(refreshedAt)}</span>
              <span className="ml-2 text-gray-400">(weekly cron Mon 6 AM ET)</span>
            </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="text-red-500 text-xs">{error}</span>}
            {refreshing && <span className="text-blue-500 text-xs animate-pulse">Refreshing from GHL...</span>}
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

        <div className="p-6 space-y-6">
          {/* Weekly Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr>
                    {COLUMN_GROUPS.map((g) => (
                      <th key={g.label} colSpan={g.columns.length}
                        className={`${g.color} text-white text-center px-2 py-2 font-semibold text-xs uppercase tracking-wider border-r border-white/20`}>
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-gray-50">
                    {allColumns.map((col) => (
                      <th key={col.key} className="px-3 py-2 font-semibold text-gray-600 text-xs whitespace-nowrap border-r border-gray-100 text-center">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, i) => (
                    <tr key={i} className="hover:bg-blue-50/30 transition border-b border-gray-50">
                      {allColumns.map((col) => (
                        <td key={col.key} className="px-3 py-2 whitespace-nowrap text-center border-r border-gray-50">
                          {renderCell(week as unknown as Record<string, number | string>, col, false, i)}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Monthly summaries */}
                  {monthlySummaries.map((ms) => (
                    <SummaryRow key={ms.label} row={ms} className="bg-amber-50 border-t-2 border-amber-300 text-amber-900" />
                  ))}

                  {/* Q1 */}
                  <SummaryRow row={q1Summary} className="bg-indigo-50 border-t-2 border-indigo-300 text-indigo-900" />

                  {/* YTD */}
                  <SummaryRow row={ytdSummary} className="bg-emerald-50 border-t-2 border-emerald-300 text-emerald-900" />
                  <SummaryRow row={ytdAvg} className="bg-blue-50 border-t border-blue-200 text-blue-900" />
                </tbody>
              </table>
            </div>
          </div>

          {/* Mike vs Josh Leaderboard */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Sales Leaderboard - Mike (In-Person) vs Josh (Virtual)</h3>
            <div className="grid grid-cols-2 gap-6">
              {[
                { name: "Mike", data: leaderboard.mike, color: "blue" },
                { name: "Josh", data: leaderboard.josh, color: "purple" },
              ].map(({ name, data, color }) => (
                <div key={name} className={`border rounded-lg p-4 ${color === "blue" ? "border-blue-200 bg-blue-50/50" : "border-purple-200 bg-purple-50/50"}`}>
                  <h4 className={`font-bold text-lg ${color === "blue" ? "text-blue-900" : "text-purple-900"}`}>{name}</h4>
                  <div className="grid grid-cols-4 gap-3 mt-3">
                    {[
                      { label: "Appts", val: data.appts },
                      { label: "Offers", val: data.offers },
                      { label: "Signed", val: data.signed },
                      { label: "Settled", val: data.settled },
                    ].map((m) => (
                      <div key={m.label} className="text-center">
                        <p className="text-2xl font-bold text-gray-900">{m.val}</p>
                        <p className="text-xs text-gray-500">{m.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Weekly Volume Chart */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Weekly Volume Trends</h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Leads" fill="#10b981" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Connects" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="IP Appts" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="V Appts" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="A-B" fill="#ef4444" radius={[2, 2, 0, 0]} />
                <Bar dataKey="Settled" fill="#06b6d4" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>
      </main>
      {drilldown && <DrilldownModal title={drilldown.title} data={drilldown.data} onClose={() => setDrilldown(null)} />}
    </div>
  );
}
