// Snapshot helpers for /api/marketing/refresh + restore.
// See scorecard/refresh/backup.ts for the rationale (Next.js App Router
// route files can only export route handlers).

export const BACKUP_KEY_PREFIX = "marketing_backup_";
export const BACKUP_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
