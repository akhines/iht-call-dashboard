import { NextResponse } from "next/server";

const BASE = "https://services.leadconnectorhq.com";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };
}

// Tracking number display names
const NUMBER_NAMES: Record<string, string> = {
  "+14108241687": "Web Leads (SEO)",
  "+14102641642": "Google Ads",
  "+14103434797": "Ted's Number",
  "+14104987172": "Emma's Number",
  "+14106506122": "Mike's Number",
  "+14109833325": "GMB Impact Home",
  "+14109276635": "Follow-Up",
  "+14106576572": "Main Line",
  "+14109413634": "Acquisitions",
  "+14102674286": "Outbound Line",
  "+14104388938": "TV Leads",
  "+14105177545": "Office Line",
  "+14109273325": "GMB Backup",
  "+14109413480": "Direct Mail 1: Zone A",
  "+14103166197": "Impact Cash Buyers Line",
  "+14439092598": "Display Ads",
};

interface GHLConversation {
  id: string;
  fullName: string | null;
  contactName: string | null;
  phone: string;
  contactId: string;
  lastMessageDate: number;
  lastMessageDirection: string;
  lastMessageType: string;
  tags?: string[];
}

interface GHLMessage {
  id: string;
  direction: string;
  status: string;
  messageType: string;
  from: string;
  to: string;
  dateAdded: string;
  meta?: { call?: { duration?: number; status?: string; recordingUrl?: string } };
}

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

async function fetchAllCallConversations(): Promise<GHLConversation[]> {
  const all: GHLConversation[] = [];
  let startAfterDate: number | null = null;
  const jan1_2026 = new Date("2026-01-01T00:00:00Z").getTime();

  // Paginate through all TYPE_CALL conversations
  for (let page = 0; page < 20; page++) {
    let url = `${BASE}/conversations/search?locationId=${process.env.GHL_LOCATION_ID}&limit=100&lastMessageType=TYPE_CALL&sort_by=last_message_date&sort_order=desc`;
    if (startAfterDate) {
      url += `&startAfterDate=${startAfterDate}`;
    }

    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) {
      console.error("GHL conversations search failed:", res.status, await res.text().catch(() => ""));
      break;
    }

    const data = await res.json();
    const convs: GHLConversation[] = data.conversations || [];
    if (convs.length === 0) break;

    // Filter to 2026 only
    for (const c of convs) {
      if (c.lastMessageDate >= jan1_2026) {
        all.push(c);
      }
    }

    // If the last conversation is before 2026, stop
    const lastDate = convs[convs.length - 1].lastMessageDate;
    if (lastDate < jan1_2026) break;

    // Use sort value for cursor pagination
    const lastSort = convs[convs.length - 1].lastMessageDate;
    startAfterDate = lastSort;

    if (convs.length < 100) break;
  }

  return all;
}

async function fetchCallMessages(conversationId: string): Promise<GHLMessage[]> {
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    console.error("GHL messages fetch failed:", conversationId, res.status);
    return [];
  }

  const data = await res.json();
  let msgs = data.messages || [];
  if (msgs && typeof msgs === "object" && !Array.isArray(msgs)) {
    msgs = msgs.messages || [];
  }

  // Filter to call messages only, in 2026
  const jan1 = new Date("2026-01-01T00:00:00Z").getTime();
  return (msgs as GHLMessage[]).filter((m) => {
    const isCall =
      m.messageType === "TYPE_CALL" || m.messageType === "TYPE_IVR_CALL";
    const date = new Date(m.dateAdded).getTime();
    return isCall && date >= jan1;
  });
}

function getNumberName(phone: string): string {
  return NUMBER_NAMES[phone] || phone;
}

function getSource(tags: string[]): string {
  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (t.includes("seo") || t.includes("google search")) return "SEO";
    if (t.includes("google ads") || t.includes("ppc")) return "Google Ads";
    if (t.includes("tv")) return "TV";
    if (t.includes("direct mail") || t.includes("mailer")) return "Direct Mail";
    if (t.includes("referral")) return "Referral";
  }
  return "";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") || "full"; // "full" or "recent"

  try {
    if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
      return NextResponse.json({
        error: "Missing env vars",
        hasToken: !!process.env.GHL_API_TOKEN,
        hasLocation: !!process.env.GHL_LOCATION_ID,
      }, { status: 500 });
    }

    const conversations = await fetchAllCallConversations();

    // For "recent" mode (polling), only get last 20 conversations
    const toProcess =
      mode === "recent" ? conversations.slice(0, 20) : conversations;

    // Fetch call messages in batches of 10 to avoid rate limiting
    const calls: CallRecord[] = [];
    const batchSize = 10;

    for (let i = 0; i < toProcess.length; i += batchSize) {
      const batch = toProcess.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (conv) => {
          const messages = await fetchCallMessages(conv.id);
          return messages.map((msg) => {
            const isInbound =
              msg.direction === "inbound" ||
              msg.messageType === "TYPE_IVR_CALL";
            const duration = msg.meta?.call?.duration || 0;
            const status = msg.meta?.call?.status || msg.status || "";
            const connected =
              status === "completed" && duration > 5;

            // For inbound: "to" is the tracking number, "from" is caller
            // For outbound: "from" is our number, "to" is the contact
            const dialedNumber = isInbound ? msg.to : msg.from;
            const callerPhone = isInbound ? msg.from : msg.to;

            return {
              id: msg.id,
              date: msg.dateAdded,
              contactName:
                conv.fullName || conv.contactName || "Unknown",
              callerPhone: callerPhone || conv.phone,
              dialedNumber,
              numberName: getNumberName(dialedNumber),
              direction: isInbound ? "inbound" : "outbound",
              connected,
              durationSecs: duration,
              hasRecording: !!msg.meta?.call?.recordingUrl,
              contactId: conv.contactId,
              source: getSource(conv.tags || []),
            };
          });
        })
      );
      calls.push(...results.flat());
    }

    // Sort by date descending
    calls.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return NextResponse.json({
      calls,
      total: calls.length,
      conversationCount: conversations.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("GHL API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch call data" },
      { status: 500 }
    );
  }
}
