import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { weekKey, WeekCacheEntry } from "../builder";
import { dmAshley } from "@/app/lib/slack-dm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Read-only daily validation cron — fires at 13:00 UTC. Does NOT rebuild.
//
// Reads every per-week scorecard KV entry, sums YTD settled, and compares
// against a fresh GHL count of won deals (Deals pipeline → Closed Deal stage,
// merged with TC pipeline → Closed Dispo stage to mirror the scorecard's
// settled definition) closed in the current year. If the drift exceeds
// ±2 deals, DM Ashley a heads-up. No writes, no rebuilds.

const BASE = "https://services.leadconnectorhq.com";
const DEALS_PIPELINE = "DiGXnGTlQCOMZQJmWQe9";
const TC_PIPELINE = "ofMQolXiKGyg6WNOJS88";
const DEALS_CLOSED_DEAL_STAGE = "245bc5b3-e2ac-4886-8928-907560ec3f15";
const TC_CLOSED_DISPO_STAGE = "8464b838-cb2d-497a-89f6-07c4025ae17f";

const JAN1_THIS_YEAR = new Date(
  `${new Date().getUTCFullYear()}-01-01T00:00:00Z`
).getTime();

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
}

function getAllWeekStartKeys(): string[] {
  const keys: string[] = [];
  const current = new Date(`${new Date().getUTCFullYear()}-01-05T00:00:00Z`);
  // Match the GET route — first Monday of the year onward, weeks that have ended.
  const now = new Date();
  while (current < now) {
    const end = new Date(current);
    end.setDate(end.getDate() + 6);
    if (end.getTime() < now.getTime()) {
      keys.push(current.toISOString().slice(0, 10));
    }
    current.setDate(current.getDate() + 7);
  }
  return keys;
}

interface OppLite {
  id: string;
  lastStageChangeAt?: string;
  createdAt?: string;
}

async function fetchClosedOppsInPipelineStage(
  pipelineId: string,
  stageId: string
): Promise<OppLite[]> {
  const results: OppLite[] = [];
  let url = `${BASE}/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&pipeline_id=${pipelineId}&pipeline_stage_id=${stageId}&limit=100`;
  for (let page = 0; page < 25; page++) {
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    for (const o of data.opportunities || []) {
      results.push({
        id: o.id,
        lastStageChangeAt: o.lastStageChangeAt,
        createdAt: o.createdAt,
      });
    }
    const next = data?.meta?.nextPageUrl;
    if (!next) break;
    url = next;
  }
  return results;
}

// Count opps that landed in their closed-stage in the current calendar year.
// Uses lastStageChangeAt when present (when they were moved into the closed
// stage) and falls back to createdAt.
function countYtdClosed(opps: OppLite[]): number {
  return opps.filter((o) => {
    const ts = o.lastStageChangeAt || o.createdAt;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return t >= JAN1_THIS_YEAR;
  }).length;
}

export async function GET(request: Request) {
  // Auth — Vercel cron passes the CRON_SECRET via Authorization header,
  // manual triggers can pass ?secret=
  const { searchParams } = new URL(request.url);
  const querySecret = searchParams.get("secret");
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (bearer !== secret && querySecret !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
    return NextResponse.json(
      { error: "Missing GHL env vars" },
      { status: 500 }
    );
  }

  // 1. Read scorecard per-week YTD settled (KV, no rebuild).
  let scorecardSettled = 0;
  let weeksRead = 0;
  try {
    const allWeekKeys = getAllWeekStartKeys();
    const kvKeys = allWeekKeys.map((k) => weekKey(k));
    const entries =
      (await kv.mget<WeekCacheEntry[]>(...kvKeys)) || [];
    for (const e of entries) {
      if (e && e.data) {
        scorecardSettled += e.data.settled || 0;
        weeksRead++;
      }
    }
  } catch (e) {
    console.error("Scorecard validate: KV read failed:", e);
    return NextResponse.json(
      { error: "KV read failed", detail: String(e) },
      { status: 500 }
    );
  }

  // 2. Fresh GHL won-deals YTD (merge of dealsClosedDeal + tcClosedDispo,
  // de-duped by opportunity id to mirror scorecard's settled definition).
  let ghlClosed = 0;
  try {
    const [dealsClosed, tcClosed] = await Promise.all([
      fetchClosedOppsInPipelineStage(DEALS_PIPELINE, DEALS_CLOSED_DEAL_STAGE),
      fetchClosedOppsInPipelineStage(TC_PIPELINE, TC_CLOSED_DISPO_STAGE),
    ]);
    const merged = new Map<string, OppLite>();
    for (const o of dealsClosed) if (o.id) merged.set(o.id, o);
    for (const o of tcClosed) if (o.id && !merged.has(o.id)) merged.set(o.id, o);
    ghlClosed = countYtdClosed(Array.from(merged.values()));
  } catch (e) {
    console.error("Scorecard validate: GHL fetch failed:", e);
    return NextResponse.json(
      { error: "GHL fetch failed", detail: String(e) },
      { status: 500 }
    );
  }

  // 3. Compare and DM if drift exceeds ±2.
  const drift = scorecardSettled - ghlClosed;
  const driftAbs = Math.abs(drift);
  const DRIFT_THRESHOLD = 2;

  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    weeksRead,
    scorecardSettled,
    ghlClosed,
    drift,
    threshold: DRIFT_THRESHOLD,
    alerted: false as boolean,
    alertReason: null as string | null,
  };

  if (driftAbs > DRIFT_THRESHOLD) {
    const direction = drift > 0 ? "more" : "fewer";
    const text = [
      ":mag: *Scorecard validation drift detected*",
      `Scorecard says *${scorecardSettled}* settled YTD, GHL has *${ghlClosed}* won deals YTD.`,
      `Drift of *${drift > 0 ? "+" : ""}${drift}* (scorecard has ${direction}).`,
      `Threshold is ±${DRIFT_THRESHOLD}. Read-only check — no rebuild was triggered.`,
      `Check <https://iht-call-dashboard.vercel.app/marketing|/marketing> and the GHL Deals pipeline for the source of truth.`,
    ].join("\n");
    const dm = await dmAshley(text);
    result.alerted = dm.posted;
    result.alertReason = dm.posted ? null : dm.reason || "unknown";
    console.warn(
      `Scorecard validate: DRIFT scorecard=${scorecardSettled} ghl=${ghlClosed} drift=${drift} (DM posted=${dm.posted})`
    );
  } else {
    console.log(
      `Scorecard validate: OK scorecard=${scorecardSettled} ghl=${ghlClosed} drift=${drift}`
    );
  }

  return NextResponse.json(result);
}
