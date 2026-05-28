import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { weekKey, MarketingWeekCacheEntry } from "../../builder";
import { BACKUP_KEY_PREFIX } from "../backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/marketing/refresh/restore?backup=<ISO timestamp>&secret=<CRON_SECRET>
//
// Copies a snapshot blob back to per-week keys. See scorecard restore route
// for the full pattern — same auth and modes.
export async function GET(request: Request) {
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

  const backupTs = searchParams.get("backup");
  const listOnly = searchParams.get("list") === "true";
  if (!backupTs) {
    return NextResponse.json(
      { error: "Missing ?backup=<ISO timestamp> param" },
      { status: 400 }
    );
  }

  const fullKey = backupTs.startsWith(BACKUP_KEY_PREFIX)
    ? backupTs
    : `${BACKUP_KEY_PREFIX}${backupTs}`;

  try {
    const blob = await kv.get<{
      snapshot: Record<string, MarketingWeekCacheEntry>;
      capturedAt: string;
      weekCount: number;
    }>(fullKey);
    if (!blob || !blob.snapshot) {
      return NextResponse.json(
        { error: `No backup found at ${fullKey} (may have expired or never existed)` },
        { status: 404 }
      );
    }

    const weeks = Object.keys(blob.snapshot).sort();
    if (listOnly) {
      return NextResponse.json({
        ok: true,
        backupKey: fullKey,
        capturedAt: blob.capturedAt,
        weekCount: weeks.length,
        weeks,
      });
    }

    const writes: { week: string; persisted: boolean }[] = [];
    for (const week of weeks) {
      const entry = blob.snapshot[week];
      if (!entry || !entry.data) {
        writes.push({ week, persisted: false });
        continue;
      }
      await kv.set(weekKey(week), entry);
      writes.push({ week, persisted: true });
    }

    console.log(
      `Marketing restore: restored ${writes.filter((w) => w.persisted).length}/${weeks.length} weeks from ${fullKey}`
    );

    return NextResponse.json({
      ok: true,
      backupKey: fullKey,
      capturedAt: blob.capturedAt,
      restoredCount: writes.filter((w) => w.persisted).length,
      writes,
    });
  } catch (error) {
    console.error("Marketing restore error:", error);
    return NextResponse.json(
      { error: "Restore failed", detail: String(error) },
      { status: 500 }
    );
  }
}
