// Snapshot helpers for /api/scorecard/refresh + restore.
// Lives outside route.ts because Next.js route segment files can only
// export the route handler exports (GET, POST, etc.), not arbitrary
// constants — exporting both from one file fails the App Router type check.

export const BACKUP_KEY_PREFIX = "scorecard_backup_";
export const BACKUP_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
