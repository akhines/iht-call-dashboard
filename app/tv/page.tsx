"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ─── TYPES ────────────────────────────────────────────────────────────────
interface ChannelRow {
  station: string;
  group: string | null;
  spots: number;
  spend: number;
  calls: number;
  costPerCall: number;
  leads: number;
  appts: number;
  closings: number;
}

interface DaypartRow {
  daypart: string;
  spots: number;
  spend: number;
  calls: number;
  costPerCall: number;
}

interface ProgramRow {
  program: string;
  spots: number;
  spend: number;
  calls: number;
  costPerCall: number;
}

interface RecentAiringRow {
  date: string;
  time: string;
  day: string;
  station: string;
  program: string | null;
  daypart: string | null;
  rate: number;
  calls: number;
}

interface TvPayload {
  summary: {
    totalSpots: number;
    totalSpend: number;
    totalCalls: number;
    costPerCall: number;
    monthLabel: string;
    billingMonth: string;
  };
  channels: ChannelRow[];
  dayparts: DaypartRow[];
  programs: ProgramRow[];
  recentAirings: RecentAiringRow[];
  monthsAvailable: string[];
}

// ─── CONFIG ───────────────────────────────────────────────────────────────
// bcdi-api hostname for the data + ingest endpoints. Set on the dashboard
// env, falls back to the Fly hostname.
const BCDI_API =
  process.env.NEXT_PUBLIC_BCDI_API || "https://bcdi-api.fly.dev";

const GROUP_BADGE: Record<string, string> = {
  Sinclair: "bg-blue-100 text-blue-700 border-blue-200",
  Hearst: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Scripps: "bg-amber-100 text-amber-700 border-amber-200",
};

const DAYPART_LABEL: Record<string, string> = {
  overnight: "Overnight (2-5 AM)",
  "early-morning": "Early Morning (5-9 AM)",
  daytime: "Daytime (9 AM-3 PM)",
  "late-fringe": "Late Fringe (3-5 PM)",
  "early-evening": "Early Evening (5-7 PM)",
  primetime: "Primetime (7-11 PM)",
  "late-night": "Late Night (11 PM-2 AM)",
};

const DAYPART_ORDER = [
  "overnight",
  "early-morning",
  "daytime",
  "late-fringe",
  "early-evening",
  "primetime",
  "late-night",
];

// ─── FORMATTERS ───────────────────────────────────────────────────────────
function fmtMoney0(v: number): string {
  if (!isFinite(v) || v <= 0) return "$0";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtCostPer(spend: number, count: number): string {
  if (!spend || !count) return "—";
  const v = spend / count;
  if (!isFinite(v) || v <= 0) return "—";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

// Convert API's `monthLabel` (e.g. "Feb 2026") to a YYYY-MM string for the <select>.
const MONTH_NAMES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function monthLabelToYM(label: string): string {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{4})/);
  if (!m) return "";
  const num = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()];
  return num ? `${m[2]}-${num}` : "";
}

function fmtMonthInput(billingMonth: string): string {
  // YYYY-MM → "Feb 2026" using en-US locale.
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) return billingMonth;
  const [y, m] = billingMonth.split("-").map((x) => parseInt(x, 10));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${y}`;
}

// ─── UPLOAD ICONS ─────────────────────────────────────────────────────────
const UploadIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);
const TVIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="5" width="18" height="13" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 18v3" />
  </svg>
);

// ─── PAGE ─────────────────────────────────────────────────────────────────
export default function TvPage() {
  const [data, setData] = useState<TvPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchData = useCallback(
    async (month?: string) => {
      setLoading(true);
      setError("");
      try {
        const url = `${BCDI_API}/api/tv/data${month ? `?month=${encodeURIComponent(month)}` : ""}`;
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json: TvPayload = await r.json();
        setData(json);
        // Auto-select the dropdown to whichever month the API returned data for.
        // The API summary uses `monthLabel` (e.g. "Feb 2026"); convert to YYYY-MM for the <select> value.
        if (!selectedMonth && json.summary.monthLabel) {
          const ym = monthLabelToYM(json.summary.monthLabel);
          if (ym) setSelectedMonth(ym);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to load TV data: ${msg}`);
      } finally {
        setLoading(false);
      }
    },
    [selectedMonth],
  );

  useEffect(() => {
    fetchData(selectedMonth || undefined);
  }, [selectedMonth, fetchData]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      // `kind` omitted — server auto-detects. Upload routes through
      // /api/tv/upload (server-side proxy) so the BCDI_API_KEY stays in
      // server env vars, never sent to the browser.
      const r = await fetch(`/api/tv/upload`, {
        method: "POST",
        body: fd,
      });
      const json = await r.json();
      if (!r.ok) {
        setUploadMsg(`Error: ${json.error || r.status}`);
        return;
      }
      const summary = json.kind === "hga_master"
        ? `HGA master ingested — ${json.invoicesUpserted} stations updated.`
        : `Station detail ingested — ${json.airingsInserted}/${json.airingsParsed} new spots from ${json.invoicesUpserted} invoice(s).`;
      setUploadMsg(summary);
      await fetchData(selectedMonth || undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadMsg(`Error: ${msg}`);
    } finally {
      setUploading(false);
    }
  }

  // Group rollup for the channel cards (Sinclair / Hearst / Scripps).
  const channelGroups = useMemo(() => {
    if (!data) return [];
    const map: Record<string, { group: string; rows: ChannelRow[]; spots: number; spend: number; calls: number; leads: number; appts: number; closings: number }> = {};
    for (const c of data.channels) {
      const g = c.group || "Other";
      if (!map[g]) map[g] = { group: g, rows: [], spots: 0, spend: 0, calls: 0, leads: 0, appts: 0, closings: 0 };
      map[g].rows.push(c);
      map[g].spots += c.spots;
      map[g].spend += c.spend;
      map[g].calls += c.calls;
      map[g].leads += c.leads;
      map[g].appts += c.appts;
      map[g].closings += c.closings;
    }
    return Object.values(map).sort((a, b) => b.spend - a.spend);
  }, [data]);

  const dayparts = useMemo(() => {
    if (!data) return [];
    // Sort by configured natural order so the heatmap reads chronologically.
    const order = new Map(DAYPART_ORDER.map((k, i) => [k, i]));
    return [...data.dayparts].sort((a, b) => (order.get(a.daypart) ?? 99) - (order.get(b.daypart) ?? 99));
  }, [data]);

  // Heatmap color scale for cost/call (low cost = green, high cost = red).
  const cpcMax = useMemo(() => {
    if (!data) return 0;
    return Math.max(0, ...data.dayparts.filter((d) => d.calls > 0).map((d) => d.spend / d.calls));
  }, [data]);
  function heatColorForCpc(cpc: number): string {
    if (!cpc || cpc <= 0 || cpcMax <= 0) return "bg-gray-50";
    const ratio = cpc / cpcMax;
    if (ratio < 0.34) return "bg-emerald-100";
    if (ratio < 0.67) return "bg-amber-100";
    return "bg-rose-100";
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      {/* ─── SIDEBAR ─── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 flex-shrink-0 flex flex-col transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "#1a1f36" }}
      >
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div>
              <h1 className="text-white font-bold text-sm leading-tight">Impact Home</h1>
              <p className="text-blue-300 text-xs">TV Performance</p>
            </div>
            <button className="ml-auto lg:hidden text-gray-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {/* Ops Scorecard parent */}
          <a href="/scorecard" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Ops Scorecard
          </a>
          <a href="/call-dashboard" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Calls
          </a>

          {/* Marketing parent */}
          <a href="/marketing" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 mt-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
            </svg>
            Marketing
          </a>
          <a href="/direct-mail" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 0v10a2 2 0 002 2h14a2 2 0 002-2V8m-18 0l9-5 9 5" />
            </svg>
            Direct Mail
          </a>
          <a href="/google-ads" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Google Ads
          </a>
          <a href="/seo" className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-white/10 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            SEO
          </a>
          <button className="w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm bg-white/10 text-white border-l-2 border-white/10 ml-3">
            <TVIcon />
            TV
          </button>
        </nav>
        <div className="p-4 border-t border-white/10">
          <p className="text-gray-500 text-xs text-center">Impact Home Team &copy; 2026</p>
        </div>
      </aside>

      {/* ─── MAIN ─── */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100" onClick={() => setSidebarOpen(true)}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h2 className="text-lg font-bold text-gray-900">2026 TV Performance</h2>
              <p className="text-sm text-gray-500 hidden sm:block">
                Per-month TV invoice ingest &middot; airing-level call attribution
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {data && (
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                {data.monthsAvailable.length === 0 ? (
                  <option value="">No data</option>
                ) : (
                  data.monthsAvailable.map((m) => (
                    <option key={m} value={m}>{fmtMonthInput(m)}</option>
                  ))
                )}
              </select>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium transition disabled:opacity-50"
            >
              <UploadIcon />
              <span className="hidden sm:inline">{uploading ? "Uploading…" : "Upload Invoice PDF"}</span>
              <span className="sm:hidden">{uploading ? "…" : "Upload"}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
          </div>
        </header>
        {uploadMsg && (
          <div className="px-4 sm:px-6 pt-2">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-900">
              {uploadMsg}
            </div>
          </div>
        )}
        {error && (
          <div className="px-4 sm:px-6 pt-2">
            <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-900">
              {error}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-[60vh] items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              <p className="mt-4 text-gray-500 font-medium">Loading TV data…</p>
            </div>
          </div>
        ) : !data || data.summary.totalSpots === 0 ? (
          <div className="p-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
              <TVIcon />
              <h3 className="text-lg font-bold text-gray-900 mt-3">No TV invoices yet</h3>
              <p className="text-sm text-gray-500 mt-1">
                Click <span className="font-semibold">Upload Invoice PDF</span> to import an HGA agency master invoice or a per-station detail invoice.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-6 space-y-6">
            {/* ─── MONTHLY SUMMARY ─── */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                {data.summary.monthLabel} Summary
              </h3>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <KpiTile label="Total Spend" value={fmtMoney0(data.summary.totalSpend)} />
                  <KpiTile label="Total Spots" value={data.summary.totalSpots.toLocaleString()} />
                  <KpiTile label="Total Calls" value={data.summary.totalCalls.toLocaleString()} />
                  <KpiTile label="Cost / Call" value={data.summary.totalCalls > 0 ? fmtMoney0(data.summary.costPerCall) : "—"} />
                </div>
              </div>
            </section>

            {/* ─── CHANNEL PERFORMANCE GRID ─── */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                Channel Performance
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {channelGroups.map((g) => {
                  const badge = GROUP_BADGE[g.group] || "bg-gray-100 text-gray-700 border-gray-200";
                  return (
                    <div key={g.group} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badge}`}>
                          {g.group}
                        </span>
                        <span className="text-xs text-gray-400">{g.rows.length} station{g.rows.length === 1 ? "" : "s"}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Spend</p>
                          <p className="text-lg font-bold text-gray-900">{fmtMoney0(g.spend)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Spots</p>
                          <p className="text-lg font-bold text-gray-900">{g.spots.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Calls</p>
                          <p className="text-lg font-bold text-gray-900">{g.calls.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Cost / Call</p>
                          <p className="text-lg font-bold text-gray-900">{fmtCostPer(g.spend, g.calls)}</p>
                        </div>
                      </div>
                      <div className="border-t border-gray-100 pt-2 space-y-1.5">
                        {g.rows.map((s) => (
                          <div key={s.station} className="flex justify-between text-xs">
                            <span className="text-gray-500">{s.station}</span>
                            <span className="font-medium text-gray-900">
                              {s.spots} spot{s.spots === 1 ? "" : "s"} &middot; {fmtMoney0(s.spend)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ─── DAYPART HEATMAP ─── */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                Daypart Performance
              </h3>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Daypart</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Spots</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Spend</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Calls</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Cost / Call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayparts.map((d) => {
                      const cpc = d.calls > 0 ? d.spend / d.calls : 0;
                      const heat = heatColorForCpc(cpc);
                      return (
                        <tr key={d.daypart} className={`${heat} border-b border-gray-50`}>
                          <td className="px-4 py-2 font-medium text-gray-900">{DAYPART_LABEL[d.daypart] || d.daypart}</td>
                          <td className="px-4 py-2 text-right">{d.spots.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right">{fmtMoney0(d.spend)}</td>
                          <td className="px-4 py-2 text-right">{d.calls.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right font-semibold">
                            {d.calls > 0 ? fmtMoney0(cpc) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ─── PROGRAM PERFORMANCE ─── */}
            {data.programs.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                  Program Performance — Top 20 by Spots
                </h3>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Program</th>
                          <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Spots</th>
                          <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Spend</th>
                          <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Calls</th>
                          <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Cost / Call</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.programs.map((p, i) => {
                          const cpc = p.calls > 0 ? p.spend / p.calls : 0;
                          return (
                            <tr key={`${p.program}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                              <td className="px-4 py-2 font-medium text-gray-900 truncate max-w-[280px]" title={p.program}>{p.program}</td>
                              <td className="px-4 py-2 text-right">{p.spots.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right">{fmtMoney0(p.spend)}</td>
                              <td className="px-4 py-2 text-right">{p.calls.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right font-semibold">
                                {p.calls > 0 ? fmtMoney0(cpc) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* ─── RECENT AIRINGS ─── */}
            {data.recentAirings.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                  Recent Airings — Last 30
                </h3>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Date</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Day</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Time</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Station</th>
                          <th className="px-4 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Program / Daypart</th>
                          <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Rate</th>
                          <th className="px-4 py-2 text-right font-semibold text-gray-600 uppercase tracking-wider text-[11px]">Calls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentAirings.map((r, i) => (
                          <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-2 text-gray-700">{r.date}</td>
                            <td className="px-4 py-2 text-gray-700">{r.day}</td>
                            <td className="px-4 py-2 text-gray-700">{r.time}</td>
                            <td className="px-4 py-2 font-medium text-gray-900">{r.station}</td>
                            <td className="px-4 py-2 text-gray-700 truncate max-w-[260px]" title={r.program || r.daypart || ""}>
                              {r.program || r.daypart || "—"}
                            </td>
                            <td className="px-4 py-2 text-right">{r.rate > 0 ? fmtMoney0(r.rate) : "—"}</td>
                            <td className="px-4 py-2 text-right">{r.calls}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
