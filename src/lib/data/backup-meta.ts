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

/** Remember a backup download (every download path calls this). */
export function recordBackup(now = new Date()): void {
  try {
    window.localStorage.setItem(LAST_BACKUP_KEY, now.toISOString());
  } catch {
    /* storage blocked — nothing to remember */
  }
  // "Safe Keeper": the first backup downloaded.
  signalGamification("backup-downloaded");
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
