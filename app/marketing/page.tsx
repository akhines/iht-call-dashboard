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

interface MarketingWeekData {
  weekKey: string;
  startDate: string;
  endDate: string;
  channels: Record<string, ChannelWeekData>;
}

const CHANNEL_COLORS: Record<string, string> = {
  TV: "bg-yellow-500",
  PPC: "bg-blue-500",
  Mail: "bg-green-600",
  PPL: "bg-orange-500",
  Other: "bg-gray-500",
  SEO: "bg-purple-500",
};

const CHANNEL_LABELS: Record<string, string> = {
  TV: "TV",
  PPC: "PPC (Google Ads)",
  Mail: "Direct Mail",
  PPL: "PPL",
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

function fmtMoney(v: number) { return v ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00"; }

const RefreshIcon = () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;

export default function MarketingPage() {
  const [weeks, setWeeks] = useState<MarketingWeekData[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [editingCell, setEditingCell] = useState<{ weekKey: string; channel: string; metric: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchData = () => {
    setLoading(true);
    fetch("/api/marketing")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setWeeks(data.weeks || []);
          setChannels(data.channels || []);
          setLastUpdated(data.lastUpdated || "");
        }
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

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
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col" style={{ background: "#1a1f36" }}>
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </div>
            <div><h1 className="text-white font-bold text-sm leading-tight">Impact Home</h1><p className="text-blue-300 text-xs">Marketing</p></div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <a href="/" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            Call Dashboard
          </a>
          <a href="/scorecard" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Ops Scorecard
          </a>
          <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-white/10 text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /><path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" /></svg>
            Marketing Scorecard
          </button>
        </nav>
        <div className="p-4 border-t border-white/10"><p className="text-gray-500 text-xs text-center">Impact Home Team &copy; 2026</p></div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-lg font-bold text-gray-900">2026 Marketing Scorecard</h2>
            <p className="text-sm text-gray-500">
              Channel performance by week &middot; Click spend/mailer cells to edit
              {lastUpdated && <span className="ml-2 text-xs text-gray-400">Updated {new Date(lastUpdated).toLocaleTimeString()}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saving && <span className="text-blue-500 text-xs animate-pulse">Saving...</span>}
            {error && <span className="text-red-500 text-xs">{error}</span>}
            <button onClick={fetchData} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition" title="Refresh">
              <RefreshIcon />
            </button>
          </div>
        </header>

        <div className="p-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  {/* Channel group headers */}
                  <tr>
                    <th className="bg-gray-700 text-white px-3 py-2 text-xs font-semibold sticky left-0 z-10" rowSpan={2}>Week</th>
                    {channels.map((ch) => {
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
                    {channels.map((ch) =>
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
                      {channels.map((ch) =>
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
                    {channels.map((ch) =>
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

                  {/* ROI row */}
                  <tr className="bg-blue-50 border-t border-blue-200 font-bold">
                    <td className="px-3 py-2 text-blue-900 sticky left-0 bg-blue-50 z-[5] border-r border-blue-100">ROI</td>
                    {channels.map((ch) =>
                      METRICS.map((m, idx) => {
                        const t = channelTotals[ch];
                        if (idx === 0 && t) {
                          const roi = t.spend > 0 ? Math.round(((t.grossProfit - t.spend) / t.spend) * 100) : 0;
                          return (
                            <td key={`roi-${ch}-${m.key}`} className="px-2 py-1.5 text-center text-blue-900 border-r border-blue-100" colSpan={METRICS.length}>
                              {t.spend > 0 ? `${roi}%` : "—"}
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
        </div>
      </main>
    </div>
  );
}
