// Slack DM helper — bot-token-only, Ashley-only.
//
// CLAUDE.md meta-rule #13: agent-authored Slack output goes to Ashley's DM
// (user_id UH91EBQN7), never team channels. We post via chat.postMessage
// with SLACK_BOT_TOKEN — never via the Slack MCP `slack_send_message`
// tool (that posts as Ashley).
//
// No-ops gracefully if SLACK_BOT_TOKEN isn't configured. The KV/HTTP work
// in the calling route is what matters; a missing Slack token must never
// take down a refresh or validation route.

const ASHLEY_USER_ID = "UH91EBQN7";

interface PostResult {
  posted: boolean;
  reason?: string;
}

export async function dmAshley(text: string): Promise<PostResult> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.warn("[slack-dm] SLACK_BOT_TOKEN not configured — skipping DM");
    return { posted: false, reason: "no_token" };
  }

  try {
    // Open / fetch the IM channel so we can post into it.
    const openRes = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({ users: ASHLEY_USER_ID }),
    });
    const openData = (await openRes.json()) as {
      ok: boolean;
      channel?: { id: string };
      error?: string;
    };
    if (!openData.ok || !openData.channel?.id) {
      console.error("[slack-dm] conversations.open failed:", openData);
      return { posted: false, reason: `conversations.open: ${openData.error}` };
    }

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: openData.channel.id,
        text,
        mrkdwn: true,
      }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error("[slack-dm] chat.postMessage failed:", data);
      return { posted: false, reason: `chat.postMessage: ${data.error}` };
    }
    return { posted: true };
  } catch (e) {
    console.error("[slack-dm] threw:", e);
    return { posted: false, reason: String(e) };
  }
}
