"use client";

import { useState, useEffect, useMemo } from "react";

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
}

type ColFmt = (v: number | string) => string;

function fmtDate(v: number | string) {
  const iso = String(v);
  if (!iso || iso === "Total" || iso === "Avg/Week" || iso === "") return String(v);
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
}

function fmtPct(v: number | string) { const n = Number(v); return n ? `${n.toFixed(1)}%` : "0%"; }
function fmtDur(v: number | string) { const s = Number(v); const m = Math.floor(s / 60), r = s % 60; return m ? `${m}m ${r}s` : `${r}s`; }
function fmtMoney(v: number | string) { const n = Number(v); return n ? `$${n.toLocaleString()}` : "$0"; }

interface Column {
  key: string;
  label: string;
  fmt?: ColFmt;
}

const COLUMN_GROUPS: { label: string; color: string; columns: Column[] }[] = [
  {
    label: "Date Range",
    color: "bg-gray-700",
    columns: [
      { key: "startDate", label: "Start", fmt: fmtDate },
      { key: "endDate", label: "End", fmt: fmtDate },
    ],
  },
  {
    label: "Calls",
    color: "bg-blue-600",
    columns: [
      { key: "dials", label: "Dials" },
      { key: "totalInbound", label: "Inbound" },
      { key: "pickUpRate", label: "Pick Up %", fmt: fmtPct },
      { key: "missedCalls", label: "Missed" },
      { key: "connects", label: "Connects" },
      { key: "avgCallDuration", label: "Avg Duration", fmt: fmtDur },
      { key: "connectRate", label: "Connect %", fmt: fmtPct },
    ],
  },
  {
    label: "Leads",
    color: "bg-emerald-600",
    columns: [
      { key: "leads", label: "Leads" },
      { key: "prospects", label: "Prospects" },
      { key: "bookingPct", label: "Booking %", fmt: fmtPct },
    ],
  },
  {
    label: "Appointments",
    color: "bg-amber-600",
    columns: [
      { key: "inPersonBooked", label: "In-Person" },
      { key: "virtualBooked", label: "Virtual" },
      { key: "cancelledInPerson", label: "Canc. IP" },
      { key: "cancelledVirtual", label: "Canc. V" },
      { key: "rescheduled", label: "Resched." },
      { key: "inPersonCompleted", label: "IP Done" },
      { key: "virtualCompleted", label: "V Done" },
      { key: "showRateInPerson", label: "Show % IP", fmt: fmtPct },
      { key: "showRateVirtual", label: "Show % V", fmt: fmtPct },
    ],
  },
  {
    label: "Offers & Deals",
    color: "bg-purple-600",
    columns: [
      { key: "inPersonOffers", label: "IP Offers" },
      { key: "virtualOffers", label: "V Offers" },
      { key: "abSigned", label: "A-B Signed" },
      { key: "bcSigned", label: "B-C Signed" },
      { key: "settled", label: "Settled" },
      { key: "grossProfit", label: "Gross Profit", fmt: fmtMoney },
      { key: "netProfit", label: "Net Profit", fmt: fmtMoney },
    ],
  },
];

const allColumns = COLUMN_GROUPS.flatMap((g) => g.columns);

function computeTotals(weeks: WeekData[]): Record<string, number | string> {
  const totals: Record<string, number | string> = { startDate: "Total", endDate: "" };
  for (const col of allColumns) {
    if (col.key === "startDate" || col.key === "endDate") continue;
    if (col.key.includes("Rate") || col.key.includes("Pct") || col.key === "pickUpRate" || col.key === "bookingPct") {
      // Average the percentages
      const vals = weeks.map((w) => (w as unknown as Record<string, number>)[col.key]).filter((v) => v > 0);
      totals[col.key] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    } else if (col.key === "avgCallDuration") {
      const vals = weeks.map((w) => w.avgCallDuration).filter((v) => v > 0);
      totals[col.key] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    } else {
      totals[col.key] = weeks.reduce((a, w) => a + ((w as unknown as Record<string, number>)[col.key] || 0), 0);
    }
  }
  return totals;
}

function computeAverages(weeks: WeekData[]): Record<string, number | string> {
  const avgs: Record<string, number | string> = { startDate: "Avg/Week", endDate: "" };
  const n = weeks.length || 1;
  for (const col of allColumns) {
    if (col.key === "startDate" || col.key === "endDate") continue;
    if (col.key.includes("Rate") || col.key.includes("Pct") || col.key === "pickUpRate" || col.key === "bookingPct") {
      const vals = weeks.map((w) => (w as unknown as Record<string, number>)[col.key]).filter((v) => v > 0);
      avgs[col.key] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    } else if (col.key === "avgCallDuration") {
      const vals = weeks.map((w) => w.avgCallDuration).filter((v) => v > 0);
      avgs[col.key] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    } else {
      avgs[col.key] = Math.round(weeks.reduce((a, w) => a + ((w as unknown as Record<string, number>)[col.key] || 0), 0) / n * 100) / 100;
    }
  }
  return avgs;
}

const RefreshIcon = () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;

export default function ScorecardPage() {
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  useEffect(() => {
    fetch("/api/scorecard")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setWeeks(data.weeks || []);
          setLastUpdated(data.lastUpdated || "");
        }
      })
      .catch(() => setError("Failed to load scorecard"))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => computeTotals(weeks), [weeks]);
  const averages = useMemo(() => computeAverages(weeks), [weeks]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-500 font-medium">Building scorecard from GHL data...</p>
          <p className="mt-2 text-gray-400 text-sm">This may take a minute on first load</p>
        </div>
      </div>
    );
  }

  function renderCell(row: Record<string, number | string>, col: Column, isSummary = false) {
    const val = row[col.key];
    if (col.key === "startDate" || col.key === "endDate") {
      if (isSummary) return <span className="font-bold text-gray-900">{val}</span>;
      return <span className="text-gray-700">{col.fmt ? col.fmt(val) : val}</span>;
    }
    const display = col.fmt ? col.fmt(val) : Number(val).toLocaleString();
    return <span className={isSummary ? "font-bold" : ""}>{display}</span>;
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
        </nav>
        <div className="p-4 border-t border-white/10"><p className="text-gray-500 text-xs text-center">Impact Home Team &copy; 2026</p></div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-bold text-gray-900">2026 Operations Scorecard</h2>
            <p className="text-sm text-gray-500">
              Weekly KPIs auto-pulled from GHL &middot; {weeks.length} weeks
              {lastUpdated && <span className="ml-2 text-xs text-gray-400">Updated {new Date(lastUpdated).toLocaleTimeString()}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="text-red-500 text-xs">{error}</span>}
            <button onClick={() => { setLoading(true); setError(""); fetch("/api/scorecard").then(r => r.json()).then(d => { setWeeks(d.weeks || []); setLastUpdated(d.lastUpdated || ""); }).catch(() => setError("Failed")).finally(() => setLoading(false)); }}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition" title="Refresh">
              <RefreshIcon />
            </button>
          </div>
        </header>

        <div className="p-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                {/* Column group headers */}
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
                  {/* Weekly rows */}
                  {weeks.map((week, i) => (
                    <tr key={i} className="hover:bg-blue-50/30 transition border-b border-gray-50">
                      {allColumns.map((col) => (
                        <td key={col.key} className="px-3 py-2 whitespace-nowrap text-center border-r border-gray-50">
                          {renderCell(week as unknown as Record<string, number | string>, col)}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {/* Totals row */}
                  {weeks.length > 0 && (
                    <tr className="bg-emerald-50 border-t-2 border-emerald-300">
                      {allColumns.map((col) => (
                        <td key={col.key} className="px-3 py-2 whitespace-nowrap text-center border-r border-emerald-100 font-bold text-emerald-900">
                          {renderCell(totals, col, true)}
                        </td>
                      ))}
                    </tr>
                  )}

                  {/* Averages row */}
                  {weeks.length > 0 && (
                    <tr className="bg-blue-50 border-t border-blue-200">
                      {allColumns.map((col) => (
                        <td key={col.key} className="px-3 py-2 whitespace-nowrap text-center border-r border-blue-100 font-bold text-blue-900">
                          {renderCell(averages, col, true)}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
