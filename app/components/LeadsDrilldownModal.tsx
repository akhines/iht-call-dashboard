"use client";

// Shared Leads drilldown modal — used by both /scorecard and /marketing.
// Opens when Ashley clicks a Leads count cell. Renders:
//   • total count + week label
//   • pipeline chips (Leads/Mike/Josh/OfferFu/TC/Deals/Dead), emerald-tinted
//     when count > 0
//   • channel chips (sorted desc by count)
//   • scrollable table: Name (linked to GHL contact page in new tab), Pipeline,
//     Channel, Added ET timestamp
//   • Mobile: Pipeline + Channel collapse into subtitle under name

import type { LeadRecord } from "./scorecard-types";
import { PIPELINE_NAMES, PIPELINE_ORDER, GHL_LOCATION_ID } from "./scorecard-types";

export interface LeadsDrilldownModalProps {
  title: string;
  byPipeline: Record<string, number>;
  byChannel: Record<string, number>;
  leads: LeadRecord[];
  onClose: () => void;
}

export default function LeadsDrilldownModal({
  title,
  byPipeline,
  byChannel,
  leads,
  onClose,
}: LeadsDrilldownModalProps) {
  const total = leads.length;
  // Pipeline chips — fixed whitelist order for consistency.
  const pipelineChips = PIPELINE_ORDER.map((pid) => ({
    label: PIPELINE_NAMES[pid],
    count: byPipeline?.[pid] || 0,
  }));
  // Channel chips — sort by count desc, then label asc. Drop zeros.
  const channelChips = Object.entries(byChannel || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .filter(([, c]) => c > 0)
    .map(([label, count]) => ({ label, count }));

  const fmtAdded = (ms: number) => {
    try {
      return new Date(ms).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return String(ms);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900 text-base">{title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {total} {total === 1 ? "lead" : "leads"} this week
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            aria-label="Close drilldown"
          >
            &times;
          </button>
        </div>

        {/* Chips */}
        <div className="px-5 py-3 border-b border-gray-100 space-y-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
              By Pipeline
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pipelineChips.map((c) => (
                <span
                  key={c.label}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                    c.count > 0
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-gray-50 text-gray-400 border-gray-200"
                  }`}
                >
                  {c.label}
                  <span className="font-bold">{c.count}</span>
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
              By Channel
            </p>
            <div className="flex flex-wrap gap-1.5">
              {channelChips.length === 0 ? (
                <span className="text-xs text-gray-400 italic">No channel data</span>
              ) : (
                channelChips.map((c) => (
                  <span
                    key={c.label}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200"
                  >
                    {c.label}
                    <span className="font-bold">{c.count}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {leads.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              No leads in this week.
            </div>
          ) : (
            <table className="w-full text-xs sm:text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-semibold text-gray-600">Name</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-600 hidden sm:table-cell">Pipeline</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-600 hidden sm:table-cell">Channel</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-600">Added</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => {
                  const name =
                    `${l.firstName} ${l.lastName}`.trim() ||
                    l.email ||
                    l.contactId;
                  const ghlUrl = `https://app.gohighlevel.com/v2/location/${GHL_LOCATION_ID}/contacts/detail/${l.contactId}`;
                  return (
                    <tr key={l.contactId} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <a
                          href={ghlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 underline font-medium"
                        >
                          {name}
                        </a>
                        <div className="text-[10px] text-gray-400 sm:hidden mt-0.5">
                          {PIPELINE_NAMES[l.primaryPipelineId] || l.primaryPipelineName || "—"}
                          {" · "}
                          {l.source || "Unknown"}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-gray-700 hidden sm:table-cell">
                        {PIPELINE_NAMES[l.primaryPipelineId] || l.primaryPipelineName || "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-700 hidden sm:table-cell">
                        {l.source || "Unknown"}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">
                        {fmtAdded(l.dateAdded)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
