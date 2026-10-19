/**
 * When to nudge a visitor to download a backup.
 *
 * Visitors' work lives only in this browser. Once there is real work in it
 * and it has gone a while without a backup, a single quiet toast offers one —
 * at most once a week, never during a live ceremony, never for the owner
 * (whose data also syncs to their account).
 */

import { isBackupKey } from "@/lib/data/backup";
import { LAST_BACKUP_KEY } from "@/lib/data/backup-meta";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Remind once the newest backup (or first visit) is this old. */
export const BACKUP_STALE_MS = 14 * DAY_MS;
/** Never remind more often than this. */
export const REMIND_GAP_MS = 7 * DAY_MS;
/** Below this much stored work there is nothing worth backing up yet. */
export const MIN_WORK_BYTES = 2048;

const FIRST_SEEN_KEY = "agile-toolkit:backup:first-seen";
const REMINDED_KEY = "agile-toolkit:backup:reminded";

export interface ReminderInput {
  now: number;
  /** First time this browser ran the toolkit with the reminder in place. */
  firstSeenAt: number;
  lastBackupAt: number | null;
  lastRemindedAt: number | null;
  /** Size of the backup-eligible data in this browser. */
  workBytes: number;
}

export function shouldRemindBackup(i: ReminderInput): boolean {
  if (i.workBytes < MIN_WORK_BYTES) return false;
  const since = i.lastBackupAt ?? i.firstSeenAt;
  if (i.now - since < BACKUP_STALE_MS) return false;
  return i.lastRemindedAt === null || i.now - i.lastRemindedAt >= REMIND_GAP_MS;
}

function readTime(storage: Storage, key: string): number | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const t = Number.isNaN(Number(raw)) ? Date.parse(raw) : Number(raw);
  return Number.isFinite(t) ? t : null;
}

function measureWork(storage: Storage): number {
  let bytes = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && isBackupKey(key)) bytes += storage.getItem(key)?.length ?? 0;
  }
  return bytes;
}

/**
 * Read this browser's reminder state, recording the first visit if needed.
 * Returns false when storage is blocked.
 */
export function backupReminderDue(
  storage: Storage = window.localStorage,
  now = Date.now()
): boolean {
  try {
    let firstSeenAt = readTime(storage, FIRST_SEEN_KEY);
    if (firstSeenAt === null) {
      storage.setItem(FIRST_SEEN_KEY, String(now));
      firstSeenAt = now;
    }
    return shouldRemindBackup({
      now,
      firstSeenAt,
      lastBackupAt: readTime(storage, LAST_BACKUP_KEY),
      lastRemindedAt: readTime(storage, REMINDED_KEY),
      workBytes: measureWork(storage),
    });
  } catch {
    return false;
  }
}

export function recordBackupReminder(storage: Storage = window.localStorage, now = Date.now()) {
  try {
    storage.setItem(REMINDED_KEY, String(now));
  } catch {
    /* storage blocked */
  }
}
