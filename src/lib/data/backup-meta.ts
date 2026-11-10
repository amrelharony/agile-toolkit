/**
 * Small bits of state around backups: when the last one was taken, and
 * telling other open tabs that this browser's data was replaced.
 */

import { LOCAL_DATA_CHANNEL } from "@/lib/utils/clear-local-data";
import { signalGamification } from "@/lib/gamification/signal";

export const LAST_BACKUP_KEY = "agile-toolkit:backup:last";

export function readLastBackupAt(): string | null {
  try {
    return window.localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

/** Fired on this window when a backup is recorded: a storage event only reaches other tabs. */
const BACKUP_RECORDED_EVENT = "agile-toolkit:backup-recorded";

/** Remember a backup download (every download path calls this). */
export function recordBackup(now = new Date()): void {
  try {
    window.localStorage.setItem(LAST_BACKUP_KEY, now.toISOString());
  } catch {
    /* storage blocked — nothing to remember */
  }
  try {
    window.dispatchEvent(new Event(BACKUP_RECORDED_EVENT));
  } catch {
    /* no window events — readers pick it up on their next render */
  }
  // "Safe Keeper": the first backup downloaded.
  signalGamification("backup-downloaded");
}

/**
 * Call `onChange` whenever the last backup's time changes: a download in
 * this tab, or one in another tab (or a restore, which rewrites storage).
 * Returns how to stop listening.
 */
export function subscribeLastBackup(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    // A null key is a whole-storage clear.
    if (e.key === null || e.key === LAST_BACKUP_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(BACKUP_RECORDED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BACKUP_RECORDED_EVENT, onChange);
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Whole calendar days, local, since the backup taken at `iso`: 0 for today
 * (and for a clock that ran ahead), null for no backup or a time that can't
 * be read.
 */
export function daysSinceBackup(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS));
}

/** From this many days on, the age is said in years: "3 years ago". */
const YEARS_FROM_DAYS = 1000;

/**
 * How long ago the last backup was, in words: "today", "yesterday", "3 days
 * ago", and from 1,000 days "2 years ago". Null for no backup.
 */
export function lastBackupAge(iso: string | null, now: Date = new Date()): string | null {
  const days = daysSinceBackup(iso, now);
  if (days === null) return null;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < YEARS_FROM_DAYS) return `${days} days ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/**
 * The widest age `lastBackupAge` writes, for a control that reserves its
 * width before it can read the real one (the saved chip's placeholder).
 */
export const LAST_BACKUP_AGE_WIDEST = "000 days ago";

/** "Last backup: 3 days ago", "Last backup: today", or "No backup yet". */
export function lastBackupText(iso: string | null, now: Date = new Date()): string {
  const age = lastBackupAge(iso, now);
  return age === null ? "No backup yet" : `Last backup: ${age}`;
}

/**
 * Tell other tabs to reload after a restore, so they don't write their old
 * in-memory state back over the restored data. (A "cleared" message would
 * make them wipe it instead; see installLocalDataChannelListener.)
 */
export function announceRestored(): void {
  try {
    const ch = new BroadcastChannel(LOCAL_DATA_CHANNEL);
    ch.postMessage({ type: "restored", at: Date.now() });
    ch.close();
  } catch {
    /* no BroadcastChannel — other tabs pick it up on their next reload */
  }
}
