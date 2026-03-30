"use client";

import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

interface SourceBreakdown { [source: string]: number; }

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
}

type ColFmt = (v: number | string) => string;

function fmtDate(v: number | string) {
  const iso = String(v);
  if (!iso || iso.startsWith("Total") || iso.startsWith("Avg") || iso.startsWith("Q") || iso.startsWith("Jan") || iso.startsWith("Feb") || iso.startsWith("Mar") || iso === "") return String(v);
  const d = new Date(iso + "T00:00:00");
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

export default function ScorecardPage() {
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [drilldown, setDrilldown] = useState<{ title: string; data: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  useEffect(() => {
    fetch("/api/scorecard")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else { setWeeks(data.weeks || []); setLastUpdated(data.lastUpdated || ""); }
      })
      .catch(() => setError("Failed to load scorecard"))
      .finally(() => setLoading(false));
  }, []);

  // Monthly/Quarterly summaries
  const monthlySummaries = useMemo(() => {
    const byMonth: Record<number, WeekData[]> = {};
    weeks.forEach((w) => { const m = new Date(w.startDate + "T00:00:00").getMonth(); if (!byMonth[m]) byMonth[m] = []; byMonth[m].push(w); });
    return Object.entries(byMonth).map(([m, ws]) => ({ label: MONTHS[parseInt(m)], ...buildSummaryRow(MONTHS[parseInt(m)], ws) }));
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

  // Aggregate source breakdowns across all weeks for pie charts
  const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

  const apptsByChannelPie = useMemo(() => {
    const totals: Record<string, number> = {};
    weeks.forEach((w) => { Object.entries(w.apptsBySource || {}).forEach(([s, n]) => { totals[s] = (totals[s] || 0) + n; }); });
    return Object.entries(totals).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [weeks]);

  const abByChannelPie = useMemo(() => {
    const totals: Record<string, number> = {};
    weeks.forEach((w) => { Object.entries(w.abBySource || {}).forEach(([s, n]) => { totals[s] = (totals[s] || 0) + n; }); });
    return Object.entries(totals).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [weeks]);

  const leadsByChannelPie = useMemo(() => {
    const totals: Record<string, number> = {};
    weeks.forEach((w) => { Object.entries(w.leadsBySource || {}).forEach(([s, n]) => { totals[s] = (totals[s] || 0) + n; }); });
    return Object.entries(totals).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [weeks]);

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
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col" style={{ background: "#1a1f36" }}>
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </div>
            <div><h1 className="text-white font-bold text-sm leading-tight">Impact Home</h1><p className="text-blue-300 text-xs">Operations</p></div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <a href="/" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
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
        </nav>
        <div className="p-4 border-t border-white/10"><p className="text-gray-500 text-xs text-center">Impact Home Team &copy; 2026</p></div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-bold text-gray-900">2026 Operations Scorecard</h2>
            <p className="text-sm text-gray-500">
              Weekly KPIs &middot; {weeks.length} weeks &middot; Click numbers for source breakdown
              {lastUpdated && <span className="ml-2 text-xs text-gray-400">Updated {new Date(lastUpdated).toLocaleTimeString()}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="text-red-500 text-xs">{error}</span>}
            <button onClick={() => { setLoading(true); setError(""); fetch("/api/scorecard?refresh=true").then(r => r.json()).then(d => { setWeeks(d.weeks || []); setLastUpdated(d.lastUpdated || ""); }).catch(() => setError("Failed")).finally(() => setLoading(false)); }}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition" title="Force Refresh">
              <RefreshIcon />
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

          {/* Pie Charts - Channel Breakdowns */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {[
              { title: "Leads by Channel", data: leadsByChannelPie },
              { title: "Appointments by Channel", data: apptsByChannelPie },
              { title: "A-B Signed by Channel", data: abByChannelPie },
            ].map(({ title, data: pieData }) => (
              <div key={title} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} dataKey="value" paddingAngle={3}
                        label={(props: { name?: string; percent?: number }) => `${props.name || ""} ${((props.percent || 0) * 100).toFixed(0)}%`}>
                        {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-gray-400 text-sm text-center py-10">No data yet</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
      {drilldown && <DrilldownModal title={drilldown.title} data={drilldown.data} onClose={() => setDrilldown(null)} />}
    </div>
  );
}
