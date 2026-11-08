/**
 * Back up and restore everything the toolkit keeps in this browser.
 *
 * Visitors' work lives only in localStorage, so a cleared cache, a browser
 * switch or Safari's 7-day eviction loses it with no way back. A backup is
 * a plain JSON file of every toolkit key, minus identity, sync bookkeeping
 * and secrets (BYOK API keys never leave the browser in a backup). Restoring
 * writes those keys back; the caller then reloads so every store rehydrates
 * from them.
 */

import { LEGACY_APP_KEYS } from "@/lib/utils/clear-local-data";

export const BACKUP_FORMAT = "agile-toolkit-backup";
export const BACKUP_VERSION = 1;
/** Refuse files bigger than this (localStorage itself tops out near 5–10 MB). */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

const APP_KEY_PREFIX = "agile-toolkit:";

/** Keys that must never travel in a backup file. */
const EXCLUDED_KEYS = new Set([
  "agile-toolkit:llm", // BYOK API keys
  "agile-toolkit:user", // realtime presence identity
  "agile-toolkit:guest-client-id",
  "agile-toolkit:owner-seen",
  "agile-toolkit:visitor-used",
  "agile-toolkit:vdna-id",
  "agile-toolkit:share-tokens", // owner share-link secrets
  "agile-toolkit:weather:cairo", // cache
  "agile-toolkit:canvas:last-catchup", // cache
  "agile-toolkit:activity", // Activity inbox: a restore must not bring back stale unread rows
  "agile-toolkit:moments", // moments waiting for Amr: this browser's own, like the inbox
  // Which loves the server counted from this device: restored elsewhere, one
  // love could be taken back from the count once per device.
  "agile-toolkit:comics:counted",
]);
const EXCLUDED_PREFIXES = [
  "agile-toolkit:sync:",
  "agile-toolkit:kudos:pending-sync",
  "agile-toolkit:backup:", // this browser's own backup bookkeeping
  "agile-toolkit:comics:entry:", // this device's daily count marks: which posters it scanned
  "agile-toolkit:comics:intro:", // which intros this device has seen: per device, by design
  "agile-toolkit:comics:draft", // the owner's unsaved stories, which can be unreleased ones
];

/** Preferences stored outside the `agile-toolkit:` prefix that are worth keeping. */
const EXTRA_KEYS = ["ae-theme"];

export interface BackupFileV1 {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  keys: Record<string, string>;
}

export type ParseResult = { ok: true; backup: BackupFileV1 } | { ok: false; error: string };

/** Whether `key` belongs in a backup. */
export function isBackupKey(key: string): boolean {
  if (EXTRA_KEYS.includes(key) || LEGACY_APP_KEYS.includes(key)) return true;
  if (!key.startsWith(APP_KEY_PREFIX)) return false;
  if (EXCLUDED_KEYS.has(key)) return false;
  return !EXCLUDED_PREFIXES.some((p) => key.startsWith(p));
}

function listKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && isBackupKey(key)) keys.push(key);
  }
  return keys.sort();
}

/** Snapshot every backup-eligible key in `storage`. */
export function collectBackup(
  storage: Storage = window.localStorage,
  now = new Date()
): BackupFileV1 {
  const keys: Record<string, string> = {};
  for (const key of listKeys(storage)) {
    const value = storage.getItem(key);
    if (value !== null) keys[key] = value;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now.toISOString(), keys };
}

/** The backup as a file body, pretty enough to diff by hand. */
export function serializeBackup(backup: BackupFileV1): string {
  return JSON.stringify(backup, null, 2);
}

/** `agile-toolkit-backup-2026-10-16.json`, in the user's local date. */
export function backupFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `agile-toolkit-backup-${y}-${m}-${d}.json`;
}

/** Drop prototype-polluting keys while parsing untrusted JSON. */
function safeReviver(key: string, value: unknown): unknown {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  return value;
}

/**
 * Re-serialise a stored value through the safe reviver when it is JSON, so a
 * crafted file can't smuggle `__proto__` into a store's rehydration.
 */
function sanitizeValue(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value, safeReviver));
  } catch {
    return value; // plain string preference (e.g. ae-theme)
  }
}

/** Validate a file the user picked. Never throws. */
export function parseBackup(text: string): ParseResult {
  if (text.length > MAX_BACKUP_BYTES) {
    return { ok: false, error: "This file is too large to be a toolkit backup." };
  }
  let data: unknown;
  try {
    data = JSON.parse(text, safeReviver);
  } catch {
    return { ok: false, error: "This file isn't valid JSON. Choose a toolkit backup (.json)." };
  }
  const obj = data as Partial<BackupFileV1> | null;
  if (!obj || typeof obj !== "object" || obj.format !== BACKUP_FORMAT) {
    return { ok: false, error: "This file isn't an Agile Toolkit backup." };
  }
  if (obj.version !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `This backup is from a newer version of the toolkit (format ${String(obj.version)}).`,
    };
  }
  if (!obj.keys || typeof obj.keys !== "object" || Array.isArray(obj.keys)) {
    return { ok: false, error: "This backup is damaged: it has no data section." };
  }
  const keys: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj.keys)) {
    if (!isBackupKey(key) || typeof value !== "string") continue;
    keys[key] = sanitizeValue(value);
  }
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: typeof obj.createdAt === "string" ? obj.createdAt : "",
      keys,
    },
  };
}

/**
 * Replace this browser's toolkit data with the backup's. Keys the backup
 * doesn't have are removed, so the result matches the backed-up browser.
 * Excluded keys (API keys, identity, sync state) are left alone. The caller
 * must reload afterwards so in-memory stores pick the data up.
 */
export function restoreBackup(
  backup: BackupFileV1,
  storage: Storage = window.localStorage
): { written: number; removed: number } {
  let removed = 0;
  for (const key of listKeys(storage)) {
    if (!(key in backup.keys)) {
      storage.removeItem(key);
      removed++;
    }
  }
  let written = 0;
  for (const [key, value] of Object.entries(backup.keys)) {
    storage.setItem(key, value);
    written++;
  }
  return { written, removed };
}
