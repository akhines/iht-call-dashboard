"use client";

import { useEffect, useMemo, useState } from "react";

// ---------- Types matching bcdi-api response ----------
interface DropRow {
  date: string;
  segment: string;
  touch: string;
  dropCode: string;
  spend: number;
  ghlTag: string;
  landingUrl: string;
  piecesMailed: number;
  leads: number;
  appointments: number;
  abSigned: number;
  closings: number;
  cpl: number;
  cpcContract: number;
  cpcClose: number;
  notes: string;
  trackingNumber: string;
}

interface SegmentBudgetRow {
  segment: string;
  allocationPct: string;
  budget: number;
  spent: number;
  remaining: number;
  pctUsed: number;
  piecesMailed: number;
  numDrops: number;
  avgCostPerPiece: number;
  avgCpl: number;
  avgCpa: number;
  cpcContract: number;
  cpcClose: number;
  notes: string;
}

interface DirectMailData {
  drops: DropRow[];
  segmentBudget: SegmentBudgetRow[];
  lastUpdated: string;
}

const API_URL =
  "https://bcdi-api.fly.dev/api/marketing/direct-mail-data";

// Q2 spend cap — used as denominator for the snapshot card.
const Q2_BUDGET_CAP = 30000;

// ---------- Formatters ----------
const fmtMoney = (n: number) =>
  n > 0
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
const fmtMoney0 = (n: number) =>
  n > 0
    ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "$0";
const fmtInt = (n: number) =>
  n > 0 ? n.toLocaleString("en-US") : "—";
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const formatAllocationPct = (raw: string): string => {
  if (!raw) return "—";
  const trimmed = raw.trim();
  // sheet may return "45%", "0.45", or "45"
  if (trimmed.endsWith("%")) return trimmed;
  const n = parseFloat(trimmed);
  if (isNaN(n)) return raw;
  if (n <= 1) return `${Math.round(n * 100)}%`;
  return `${Math.round(n)}%`;
};

const parseDateForSort = (raw: string): number => {
  if (!raw) return 0;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return Date.UTC(year, month - 1, day);
  }
  const md = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    return Date.UTC(2026, parseInt(md[1], 10) - 1, parseInt(md[2], 10));
  }
  const t = Date.parse(raw);
  return isNaN(t) ? 0 : t;
};

// Segment badge color
const segmentColor = (seg: string): string => {
  const s = seg.toLowerCase();
  if (s.includes("dataflik")) return "bg-blue-100 text-blue-700 border-blue-200";
  if (s.includes("inherit")) return "bg-red-100 text-red-700 border-red-200";
  if (s.includes("bcdi")) return "bg-amber-100 text-amber-700 border-amber-200";
  if (s.includes("nurture")) return "bg-gray-100 text-gray-700 border-gray-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
};

const progressBarColor = (pct: number): string => {
  if (pct < 0.7) return "bg-emerald-500";
  if (pct < 0.9) return "bg-amber-400";
  return "bg-red-500";
};

// ---------- Page ----------
export default function DirectMailPage() {
  const [data, setData] = useState<DirectMailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    fetch(API_URL, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: DirectMailData) => setData(d))
      .catch((e) => setError(e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Derived totals
  const totals = useMemo(() => {
    if (!data) {
      return {
        spent: 0,
        pieces: 0,
        drops: 0,
        avgPerPiece: 0,
        leads: 0,
        appts: 0,
        closings: 0,
      };
    }
    const spent = data.drops.reduce((s, d) => s + (d.spend || 0), 0);
    const pieces = data.drops.reduce((s, d) => s + (d.piecesMailed || 0), 0);
    const drops = data.drops.length;
    const leads = data.drops.reduce((s, d) => s + (d.leads || 0), 0);
    const appts = data.drops.reduce((s, d) => s + (d.appointments || 0), 0);
    const closings = data.drops.reduce((s, d) => s + (d.closings || 0), 0);
    return {
      spent,
      pieces,
      drops,
      avgPerPiece: pieces > 0 ? spent / pieces : 0,
      leads,
      appts,
      closings,
    };
  }, [data]);

  const sortedDrops = useMemo(() => {
    if (!data) return [];
    return [...data.drops].sort(
      (a, b) => parseDateForSort(b.date) - parseDateForSort(a.date),
    );
  }, [data]);

  // YTD 2026 totals (all drops with a 2026 date)
  const ytdDrops = useMemo(() => {
    if (!data) return [];
    return data.drops.filter((d) => {
      const t = parseDateForSort(d.date);
      if (!t) return false;
      return new Date(t).getUTCFullYear() === 2026;
    });
  }, [data]);

  const ytdTotals = useMemo(() => {
    const spent = ytdDrops.reduce((s, d) => s + (d.spend || 0), 0);
    const pieces = ytdDrops.reduce((s, d) => s + (d.piecesMailed || 0), 0);
    const dropsCount = ytdDrops.filter(
      (d) => (d.dropCode || "").trim().length > 0,
    ).length;
    const leads = ytdDrops.reduce((s, d) => s + (d.leads || 0), 0);
    const appts = ytdDrops.reduce((s, d) => s + (d.appointments || 0), 0);
    const abSigned = ytdDrops.reduce((s, d) => s + (d.abSigned || 0), 0);
    const closings = ytdDrops.reduce((s, d) => s + (d.closings || 0), 0);
    const avgCpl = leads > 0 ? spent / leads : 0;
    return { spent, pieces, dropsCount, leads, appts, abSigned, closings, avgCpl };
  }, [ytdDrops]);

  // YTD per-segment rollup (keep all 4 even if zero)
  const YTD_SEGMENTS = ["Dataflik", "Inherited", "BCDI", "Nurture"] as const;
  const ytdBySegment = useMemo(() => {
    return YTD_SEGMENTS.map((seg) => {
      const segLower = seg.toLowerCase();
      const rows = ytdDrops.filter((d) =>
        (d.segment || "").toLowerCase().includes(segLower),
      );
      const spent = rows.reduce((s, d) => s + (d.spend || 0), 0);
      const pieces = rows.reduce((s, d) => s + (d.piecesMailed || 0), 0);
      const leads = rows.reduce((s, d) => s + (d.leads || 0), 0);
      const dropsCount = rows.filter(
        (d) => (d.dropCode || "").trim().length > 0,
      ).length;
      const avgCpl = leads > 0 ? spent / leads : 0;
      return { segment: seg, spent, pieces, leads, dropsCount, avgCpl };
    });
  }, [ytdDrops]);

  // ---------- Render ----------
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 flex-shrink-0 flex flex-col transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "#1a1f36" }}
      >
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-white font-bold text-sm leading-tight">
                Impact Home
              </h1>
              <p className="text-blue-300 text-xs">Direct Mail</p>
            </div>
            <button
              className="ml-auto lg:hidden text-gray-400 hover:text-white"
              onClick={() => setSidebarOpen(false)}
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <a
            href="/"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            Call Dashboard
          </a>
          <a
            href="/scorecard"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Ops Scorecard
          </a>
          <a
            href="/marketing"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
              />
            </svg>
            Marketing
          </a>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-white/10 text-white">
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 0v10a2 2 0 002 2h14a2 2 0 002-2V8m-18 0l9-5 9 5"
              />
            </svg>
            Direct Mail
          </button>
        </nav>
        <div className="p-4 border-t border-white/10">
          <p className="text-gray-500 text-xs text-center">
            Impact Home Team &copy; 2026
          </p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100"
              onClick={() => setSidebarOpen(true)}
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                2026 Direct Mail Tracker
              </h2>
              <p className="text-sm text-gray-500 hidden sm:block">
                Q2 budget burn-down &middot; per-drop attribution
                {data?.lastUpdated && (
                  <span className="ml-2 text-xs text-gray-400">
                    Updated{" "}
                    {new Date(data.lastUpdated).toLocaleTimeString()}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="text-red-500 text-xs">{error}</span>}
            <button
              onClick={load}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition"
              title="Refresh"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
        </header>

        {/* Loading state */}
        {loading && !data && (
          <div className="p-12 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-500 font-medium">Loading direct mail data...</p>
          </div>
        )}

        {/* Empty / error */}
        {!loading && !data && (
          <div className="p-12 text-center">
            <p className="text-gray-500">No data available.</p>
            {error && (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            )}
          </div>
        )}

        {data && (
          <div className="p-4 sm:p-6 space-y-6">
            {/* ── Q2 Budget Cards ───────────────────────────── */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                Q2 Budget by Segment
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {data.segmentBudget.map((seg) => (
                  <div
                    key={seg.segment}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${segmentColor(seg.segment)}`}
                      >
                        {seg.segment}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatAllocationPct(seg.allocationPct)}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className="text-2xl font-bold text-gray-900">
                        {fmtMoney0(seg.spent)}
                      </span>
                      <span className="text-sm text-gray-400">
                        / {fmtMoney0(seg.budget)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-3">
                      {fmtMoney0(seg.remaining)} remaining
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-gray-100 rounded-full h-2 mb-3 overflow-hidden">
                      <div
                        className={`h-full ${progressBarColor(seg.pctUsed)} transition-all`}
                        style={{
                          width: `${Math.min(100, Math.max(0, seg.pctUsed * 100))}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{fmtPct(seg.pctUsed)} used</span>
                      <span>
                        {seg.numDrops} drop{seg.numDrops === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-xs">
                      <span className="text-gray-400">Pieces</span>
                      <span className="font-semibold text-gray-700">
                        {seg.piecesMailed.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Total Q2 Snapshot ─────────────────────────── */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                Q2 Total Snapshot
              </h3>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-3xl font-bold text-gray-900">
                    {fmtMoney0(totals.spent)}
                  </span>
                  <span className="text-base text-gray-400">
                    / {fmtMoney0(Q2_BUDGET_CAP)}
                  </span>
                  <span className="ml-3 text-sm font-semibold text-blue-600">
                    {fmtPct(totals.spent / Q2_BUDGET_CAP)} used
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 mb-5 overflow-hidden">
                  <div
                    className={`h-full ${progressBarColor(totals.spent / Q2_BUDGET_CAP)}`}
                    style={{
                      width: `${Math.min(100, (totals.spent / Q2_BUDGET_CAP) * 100)}%`,
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Pieces
                    </p>
                    <p className="text-lg font-semibold text-gray-900">
                      {totals.pieces.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Drops
                    </p>
                    <p className="text-lg font-semibold text-gray-900">
                      {totals.drops}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Avg $/Piece
                    </p>
                    <p className="text-lg font-semibold text-gray-900">
                      {totals.avgPerPiece > 0
                        ? `$${totals.avgPerPiece.toFixed(2)}`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Leads
                    </p>
                    <p className="text-lg font-semibold text-gray-900">
                      {totals.leads}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Appts
                    </p>
                    <p className="text-lg font-semibold text-gray-900">
                      {totals.appts}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Closings
                    </p>
                    <p className="text-lg font-semibold text-gray-900">
                      {totals.closings}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Drop Detail Table ─────────────────────────── */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                Drop Detail
              </h3>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        {[
                          "Date",
                          "Drop Code",
                          "Segment",
                          "Touch",
                          "Spend",
                          "Pieces",
                          "Leads",
                          "Appts",
                          "A-B Signed",
                          "Closings",
                          "CPL",
                          "CPC Close",
                          "Tracking #",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedDrops.map((d, i) => (
                        <tr
                          key={`${d.dropCode}-${i}`}
                          className="hover:bg-gray-50"
                        >
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {d.date || "—"}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-900 whitespace-nowrap">
                            {d.dropCode || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span
                              className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${segmentColor(d.segment)}`}
                            >
                              {d.segment || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                            {d.touch || "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-900 whitespace-nowrap font-medium">
                            {fmtMoney(d.spend)}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {fmtInt(d.piecesMailed)}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {d.leads > 0 ? d.leads : "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {d.appointments > 0 ? d.appointments : "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {d.abSigned > 0 ? d.abSigned : "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {d.closings > 0 ? d.closings : "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {d.cpl > 0 ? `$${d.cpl.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                            {d.cpcClose > 0 ? `$${d.cpcClose.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-500 whitespace-nowrap">
                            {d.trackingNumber || "—"}
                          </td>
                        </tr>
                      ))}
                      {sortedDrops.length === 0 && (
                        <tr>
                          <td
                            colSpan={13}
                            className="px-3 py-8 text-center text-gray-400"
                          >
                            No drops logged yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* ── YTD 2026 Totals ───────────────────────────── */}
            <section className="pt-4 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                YTD 2026 Totals
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                Year-to-date across all segments &mdash; Q1 + Q2 combined.
              </p>

              {/* Section A: YTD Wide Snapshot */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      Total Spend
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {fmtMoney0(ytdTotals.spent)}
                    </p>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      Total Drops
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {ytdTotals.dropsCount}
                    </p>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      Pieces Mailed
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {ytdTotals.pieces.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      Leads
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {ytdTotals.leads}
                    </p>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      Appointments
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {ytdTotals.appts}
                    </p>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      A-B Signed
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {ytdTotals.abSigned}
                    </p>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      Closings
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {ytdTotals.closings}
                    </p>
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                      Avg CPL
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {ytdTotals.leads > 0
                        ? `$${ytdTotals.avgCpl.toFixed(2)}`
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section B: YTD Per-Segment Tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {ytdBySegment.map((seg) => (
                  <div
                    key={seg.segment}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${segmentColor(seg.segment)}`}
                      >
                        {seg.segment}
                      </span>
                      <span className="text-xs text-gray-400">
                        {seg.dropsCount} drop
                        {seg.dropsCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500 text-xs uppercase tracking-wider">
                          YTD Spend
                        </span>
                        <span className="font-semibold text-gray-900">
                          {fmtMoney0(seg.spent)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 text-xs uppercase tracking-wider">
                          Pieces
                        </span>
                        <span className="font-semibold text-gray-700">
                          {seg.pieces.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 text-xs uppercase tracking-wider">
                          Leads
                        </span>
                        <span className="font-semibold text-gray-700">
                          {seg.leads}
                        </span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-gray-100">
                        <span className="text-gray-500 text-xs uppercase tracking-wider">
                          Avg CPL
                        </span>
                        <span className="font-semibold text-gray-900">
                          {seg.leads > 0
                            ? `$${seg.avgCpl.toFixed(2)}`
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Footer note ──────────────────────────────── */}
            <p className="text-xs text-gray-400 italic px-2">
              Per-drop Leads / Appts / A-B / Closings populate via daily 6 AM ET
              cron from GHL inbound IVR call &rarr; tracking number &rarr; most
              recent drop in 60d window. Empty values mean no calls attributed
              yet.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
