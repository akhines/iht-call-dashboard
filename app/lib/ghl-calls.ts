const BASE = "https://services.leadconnectorhq.com";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
}

const JAN1_2026 = new Date("2026-01-01T00:00:00Z").getTime();

export interface SimpleCallRecord {
  date: number;
  direction: string;
  duration: number;
  connected: boolean;
}

export async function fetchAllCalls2026(): Promise<SimpleCallRecord[]> {
  const allCalls: SimpleCallRecord[] = [];
  const allConvIds: string[] = [];
  const locationId = process.env.GHL_LOCATION_ID;

  // Collect ALL TYPE_CALL conversation IDs with proper pagination
  let startAfterDate: number | null = null;
  for (let page = 0; page < 20; page++) {
    let url = `${BASE}/conversations/search?locationId=${locationId}&limit=100&lastMessageType=TYPE_CALL&sort_by=last_message_date&sort_order=desc`;
    if (startAfterDate) url += `&startAfterDate=${startAfterDate}`;

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) break;
    const data = await res.json();
    const convs = data.conversations || [];
    if (convs.length === 0) break;

    for (const c of convs) {
      if (c.lastMessageDate >= JAN1_2026) allConvIds.push(c.id);
    }

    const lastDate = convs[convs.length - 1].lastMessageDate;
    if (lastDate < JAN1_2026) break;
    startAfterDate = lastDate;
    if (convs.length < 100) break;
  }

  console.log(`GHL Calls: found ${allConvIds.length} call conversations`);

  // Fetch messages for ALL conversations in batches
  const batchSize = 10;
  for (let i = 0; i < allConvIds.length; i += batchSize) {
    const batch = allConvIds.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (convId) => {
        const res = await fetch(`${BASE}/conversations/${convId}/messages`, { headers: getHeaders() });
        if (!res.ok) return [];
        const data = await res.json();
        let msgs = data.messages || [];
        if (msgs && typeof msgs === "object" && !Array.isArray(msgs)) msgs = msgs.messages || [];
        return msgs;
      })
    );

    for (const msgs of results) {
      for (const msg of msgs) {
        const mt = msg.messageType || "";
        if (!mt.includes("CALL")) continue;
        const msgDate = new Date(msg.dateAdded).getTime();
        if (msgDate < JAN1_2026) continue;

        const isInbound = msg.direction === "inbound" || mt === "TYPE_IVR_CALL";
        const duration = msg.meta?.call?.duration || 0;
        const status = msg.meta?.call?.status || msg.status || "";

        allCalls.push({
          date: msgDate,
          direction: isInbound ? "inbound" : "outbound",
          duration,
          connected: status === "completed" && duration >= 20,
        });
      }
    }
  }

  console.log(`GHL Calls: ${allCalls.length} total call records`);
  return allCalls;
}
