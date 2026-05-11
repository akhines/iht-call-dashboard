import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BASE = "https://services.leadconnectorhq.com";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
  };
}

const DEAL_IDS = [
  ["Dorothy*TV", "0vFLywBqLaFb6IO7P7Bg"],
  ["Jerry Branch*TV", "0cGydAyTkA9FapPtL4E4"],
  ["George Jackson*TV", "0VqRZjp8sjpz7ZAJkxvJ"],
  ["Mrs.Carter*TV", "J4A0XUxdQKR23WrvZoEt"],
  ["Ronald Jamison*TV", "SKkTjzDkRj7ceSgrbF1G"],
];

export async function GET() {
  const out: Array<Record<string, unknown>> = [];
  for (const [name, id] of DEAL_IDS) {
    try {
      const r = await fetch(`${BASE}/opportunities/${id}`, { headers: getHeaders() });
      const detail = r.ok ? await r.json() : null;
      const opp = detail?.opportunity || detail || {};
      out.push({
        name,
        id,
        httpStatus: r.status,
        topLevelKeys: detail ? Object.keys(detail).slice(0, 30) : null,
        oppKeys: opp ? Object.keys(opp).slice(0, 30) : null,
        source: opp.source ?? null,
        contactId: opp.contactId ?? null,
        lastStageChangeAt: opp.lastStageChangeAt ?? null,
        status: opp.status ?? null,
      });
    } catch (e) {
      out.push({ name, id, error: String(e) });
    }
  }
  return NextResponse.json(out);
}
