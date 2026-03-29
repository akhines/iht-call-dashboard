"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

const GHL_BASE = "https://app.gohighlevel.com/v2/location/Js1OZngrzWeqSwiHjbRx/contacts";

interface CallRecord {
  id: string;
  date: string;
  contactName: string;
  callerPhone: string;
  dialedNumber: string;
  numberName: string;
  direction: string;
  connected: boolean;
  durationSecs: number;
  hasRecording: boolean;
  contactId: string;
  source: string;
}

function fmtDur(s: number) {
  if (!s) return "0s";
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m}m ${r}s` : `${r}s`;
}

function fmtPhone(p: string) {
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") {
    return `+1 ${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return p;
}

function ghlLink(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return GHL_BASE + "?query=" + encodeURIComponent(digits);
}

function isLead(name: string) {
  const t = name.trim();
  return t !== "Unknown" && !t.toUpperCase().startsWith("NOT A LEAD") && t.startsWith("*");
}

function cleanName(n: string) {
  const t = n.trim();
  return t.startsWith("*") ? t.substring(1) : t;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

const PhoneIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>;
const ChartIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
const UsersIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
const SearchIcon = () => <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
const FilterIcon = () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>;
const ClockIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const CheckIcon = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const LinkIcon = () => <svg className="w-3 h-3 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>;
const InboundIcon = () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>;
const OutboundIcon = () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>;
const RefreshIcon = () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;

function Card({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-start gap-4">
      <div className={`p-3 rounded-lg ${color}`}>{icon}</div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function Badge({ children, color, href }: { children: React.ReactNode; color: string; href?: string }) {
  const cls: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
    gray: "bg-gray-50 text-gray-500 border-gray-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  };
  const base = `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls[color] || cls.gray}`;
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={`${base} hover:opacity-80 cursor-pointer no-underline`}>{children}</a>;
  return <span className={base}>{children}</span>;
}

const COLORS = { connected: "#10b981", missed: "#ef4444", blue: "#3b82f6" };
const PIE_COLORS = ["#10b981", "#ef4444"];

const POLL_INTERVAL = 45000;

export default function Dashboard() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [dateRange, setDateRange] = useState("month");
  const [numberFilter, setNumberFilter] = useState("");
  const [connFilter, setConnFilter] = useState("");
  const [dirFilter, setDirFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 15;

  const fetchCalls = useCallback(async (mode = "full") => {
    try {
      const res = await fetch(`/api/calls?mode=${mode}`);
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setCalls(data.calls);
      setLastUpdated(data.lastUpdated);
      setError("");
    } catch {
      setError("Failed to load calls");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCalls("full"); }, [fetchCalls]);

  useEffect(() => {
    const interval = setInterval(() => fetchCalls("recent"), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCalls]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [calls]);

  const filtered = useMemo(() => calls.filter((c) => {
    const d = new Date(c.date);
    const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    if (dateRange === "today" && diff > 1) return false;
    if (dateRange === "yesterday" && (diff < 1 || diff > 2)) return false;
    if (dateRange === "week" && diff > 7) return false;
    if (dateRange === "month" && diff > 31) return false;
    if (dateRange === "quarter" && diff > 93) return false;
    if (numberFilter && c.numberName !== numberFilter) return false;
    if (connFilter === "connected" && !c.connected) return false;
    if (connFilter === "missed" && c.connected) return false;
    if (dirFilter === "inbound" && c.direction !== "inbound") return false;
    if (dirFilter === "outbound" && c.direction !== "outbound") return false;
    if (search) {
      const s = search.toLowerCase();
      if (!cleanName(c.contactName).toLowerCase().includes(s) && !c.callerPhone.includes(s)) return false;
    }
    return true;
    }), [calls, dateRange, numberFilter, connFilter, dirFilter, search, now]);

  const numberNames = useMemo(() => Array.from(new Set(calls.map((c) => c.numberName))).sort(), [calls]);

  const stats = useMemo(() => {
    const t = filtered.length;
    const cn = filtered.filter((c) => c.connected).length;
    const rate = t ? Math.round((cn / t) * 100) : 0;
    const td = filtered.reduce((a, c) => a + c.durationSecs, 0);
    const avg = t ? Math.round(td / t) : 0;
    const leads = filtered.filter((c) => isLead(c.contactName)).length;
    const uq = new Set(filtered.map((c) => c.callerPhone)).size;
    const inbound = filtered.filter((c) => c.direction === "inbound").length;
    const outbound = filtered.filter((c) => c.direction === "outbound").length;
    const todayCalls = filtered.filter((c) => (now.getTime() - new Date(c.date).getTime()) / (1000 * 60 * 60 * 24) < 1).length;
    const weekCalls = filtered.filter((c) => (now.getTime() - new Date(c.date).getTime()) / (1000 * 60 * 60 * 24) < 7).length;
    return { total: t, conn: cn, rate, avgDur: avg, leads, unique: uq, inbound, outbound, todayCalls, weekCalls };
  }, [filtered, now]);

  const dailyData = useMemo(() => {
    const m: Record<string, { date: string; connected: number; missed: number }> = {};
    filtered.forEach((c) => {
      const k = fmtDate(c.date);
      if (!m[k]) m[k] = { date: k, connected: 0, missed: 0 };
      if (c.connected) { m[k].connected++; } else { m[k].missed++; }
    });
    return Object.values(m).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [filtered]);

  const pieData = useMemo(() => [
    { name: "Connected", value: stats.conn },
    { name: "Missed", value: stats.total - stats.conn },
  ], [stats]);

  const numberData = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach((c) => { m[c.numberName] = (m[c.numberName] || 0) + 1; });
    return Object.entries(m).map(([n, ct]) => ({ name: n, count: ct })).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const clearFilters = () => { setDateRange("month"); setNumberFilter(""); setConnFilter(""); setDirFilter(""); setSearch(""); setPage(1); };
  const hasFilters = dateRange !== "month" || numberFilter || connFilter || dirFilter || search;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-500 font-medium">Loading call data from GHL...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-60 flex-shrink-0 flex flex-col" style={{ background: "#1a1f36" }}>
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </div>
            <div><h1 className="text-white font-bold text-sm leading-tight">Impact Home</h1><p className="text-blue-300 text-xs">Call Tracking</p></div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-white/10 text-white"><ChartIcon /> Dashboard</button>

          <div className="pt-4 pb-2 px-3"><p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Date Range</p></div>
          {([["today", "Today"], ["yesterday", "Yesterday"], ["week", "This Week"], ["month", "This Month"], ["quarter", "This Quarter"], ["year", "Year to Date"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setDateRange(v); setPage(1); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${dateRange === v ? "bg-blue-500/20 text-blue-300 font-medium" : "text-gray-400 hover:text-white hover:bg-white/5"}`}>
              {l}
            </button>
          ))}

          <div className="pt-4 pb-2 px-3"><p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Connection</p></div>
          <button onClick={() => { setConnFilter(connFilter === "connected" ? "" : "connected"); setPage(1); }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${connFilter === "connected" ? "bg-emerald-500/20 text-emerald-300" : "text-gray-400 hover:text-white hover:bg-white/5"}`}>
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Connected
          </button>
          <button onClick={() => { setConnFilter(connFilter === "missed" ? "" : "missed"); setPage(1); }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${connFilter === "missed" ? "bg-red-500/20 text-red-300" : "text-gray-400 hover:text-white hover:bg-white/5"}`}>
            <span className="w-2 h-2 rounded-full bg-red-400"></span> Not Connected
          </button>

          <div className="pt-4 pb-2 px-3"><p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Direction</p></div>
          <button onClick={() => { setDirFilter(dirFilter === "inbound" ? "" : "inbound"); setPage(1); }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${dirFilter === "inbound" ? "bg-blue-500/20 text-blue-300" : "text-gray-400 hover:text-white hover:bg-white/5"}`}>
            <InboundIcon /> Inbound
          </button>
          <button onClick={() => { setDirFilter(dirFilter === "outbound" ? "" : "outbound"); setPage(1); }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2 ${dirFilter === "outbound" ? "bg-purple-500/20 text-purple-300" : "text-gray-400 hover:text-white hover:bg-white/5"}`}>
            <OutboundIcon /> Outbound
          </button>
        </nav>
        <div className="p-4 border-t border-white/10"><p className="text-gray-500 text-xs text-center">Impact Home Team &copy; 2026</p></div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Call Dashboard</h2>
            <p className="text-sm text-gray-500">
              Live call tracking &middot; {calls.length} total calls in 2026
              {lastUpdated && <span className="ml-2 text-xs text-gray-400">Updated {new Date(lastUpdated).toLocaleTimeString()}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => { setLoading(true); fetchCalls("full"); }}
              className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition" title="Refresh">
              <RefreshIcon />
            </button>
            {error && <span className="text-red-500 text-xs">{error}</span>}
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center"><SearchIcon /></span>
              <input type="text" placeholder="Search name or phone..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
          </div>
        </header>

        <div className="p-6 space-y-6">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-xs text-gray-500 font-medium">Live &middot; auto-refreshing every 45s</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card icon={<PhoneIcon />} label="Total Calls" value={stats.total}
              sub={`Today: ${stats.todayCalls} \u00B7 This Week: ${stats.weekCalls}`}
              color="bg-blue-50 text-blue-600" />
            <Card icon={<CheckIcon />} label="Answer Rate" value={`${stats.rate}%`}
              sub={`${stats.conn} connected of ${stats.total}`}
              color={stats.rate >= 50 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"} />
            <Card icon={<ClockIcon />} label="Avg Duration" value={fmtDur(stats.avgDur)}
              sub={`Inbound: ${stats.inbound} \u00B7 Outbound: ${stats.outbound}`}
              color="bg-amber-50 text-amber-600" />
            <Card icon={<UsersIcon />} label="Unique Leads" value={stats.leads}
              sub={`${stats.unique} unique callers`}
              color="bg-purple-50 text-purple-600" />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-600 font-medium"><FilterIcon /> Filters</div>
            <select value={dateRange} onChange={(e) => { setDateRange(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">Year to Date</option>
            </select>
            <select value={numberFilter} onChange={(e) => { setNumberFilter(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="">All Numbers</option>
              {numberNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={connFilter} onChange={(e) => { setConnFilter(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="">All Calls</option>
              <option value="connected">Connected</option>
              <option value="missed">Not Connected</option>
            </select>
            <select value={dirFilter} onChange={(e) => { setDirFilter(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="">All Directions</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            {hasFilters && <button onClick={clearFilters} className="ml-auto text-sm text-red-500 hover:text-red-700 font-medium">Clear All</button>}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Call Volume</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dailyData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => { const p = v.split(" "); return p[0] + " " + p[1]; }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="connected" name="Connected" fill={COLORS.connected} radius={[3, 3, 0, 0]} stackId="a" />
                  <Bar dataKey="missed" name="Missed" fill={COLORS.missed} radius={[3, 3, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Connection Rate</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" paddingAngle={3}
                    label={(props: { name?: string; percent?: number }) => `${props.name || ""} ${((props.percent || 0) * 100).toFixed(0)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Calls by Tracking Number</h3>
            <ResponsiveContainer width="100%" height={Math.max(180, numberData.length * 36)}>
              <BarChart data={numberData} layout="vertical" barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" name="Calls" fill={COLORS.blue} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Call Log</h3>
              <span className="text-xs text-gray-400">{filtered.length} calls</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Date & Time</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Contact</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Phone</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Number</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Direction</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Connected</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paged.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-gray-900 font-medium">{fmtDate(c.date)}</div>
                        <div className="text-gray-400 text-xs">{fmtTime(c.date)}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <a href={ghlLink(c.callerPhone)} target="_blank" rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline font-medium">
                            {cleanName(c.contactName)}<LinkIcon />
                          </a>
                          {isLead(c.contactName) && <Badge color="blue">LEAD</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap mono text-gray-600">{fmtPhone(c.callerPhone)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{c.numberName}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.direction === "inbound"
                          ? <Badge color="blue"><InboundIcon /><span className="ml-1">In</span></Badge>
                          : <Badge color="purple"><OutboundIcon /><span className="ml-1">Out</span></Badge>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.connected ? <Badge color="green">Yes</Badge> : <Badge color="red">No</Badge>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{fmtDur(c.durationSecs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                <p className="text-xs text-gray-500">Showing {(page - 1) * perPage + 1}&ndash;{Math.min(page * perPage, filtered.length)} of {filtered.length}</p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let p: number;
                    if (totalPages <= 7) p = i + 1;
                    else if (page <= 4) p = i + 1;
                    else if (page >= totalPages - 3) p = totalPages - 6 + i;
                    else p = page - 3 + i;
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition ${page === p ? "bg-blue-500 text-white border-blue-500" : "border-gray-200 hover:bg-gray-50"}`}>
                        {p}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
