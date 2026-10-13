/**
 * Durable record of cloud-synced blob keys (usePersisted / useCloudPersisted
 * tools, createPersistedStore stores, …) that were edited while the sync
 * engine was NOT running: signed out, a visitor, the owner's
 * "merge or discard?" answer outstanding, or an owner check unanswered.
 *
 * Why it exists: a blob adapter only knows about unpushed local edits
 * through its in-memory `dirty` flag. A page load (the OAuth round trip is
 * one) loses that flag, hydration deliberately doesn't set it (BUG-S24), so
 * the first pull after signing in applied the older cloud row over the
 * signed-out edits and they were gone for good. And when the flag DID
 * survive (an in-page switch from visitor to owner), pull() skipped and the
 * visitor's whole value was pushed over the owner's cloud row.
 *
 * With a key recorded here, the adapter's first pull/push of the session
 * reconciles instead: it fetches the cloud row and pushes
 * `mergeBlobPayloads(local, remote)` (see blob-adapter.ts), then the
 * successful push clears the record. Keys live under the `agile-toolkit:`
 * prefix, so "Clear data" / Discard / owner sign-out remove the record
 * together with the data it describes.
 */

export const UNSYNCED_BLOBS_KEY = "agile-toolkit:sync:unsynced-blobs";

/**
 * UI preferences rather than work: still reconciled, but never a reason to
 * ask the owner about "work created while signed out". The workspace
 * scalars blob is covered by the workspace-store watch in the visitor
 * tracker, which (unlike its blob adapter) ignores rehydration.
 */
const PREFERENCE_BLOB_PREFIXES: readonly string[] = [
  "agile-toolkit:tool-prefs:",
  "agile-toolkit:sidebar:",
  "agile-toolkit:insights:dismissed:",
  "agile-toolkit:workspace:scalars",
];
const PREFERENCE_BLOB_KEYS = new Set(["agile-toolkit:canvas"]);

export function isPreferenceBlob(storeKey: string): boolean {
  return (
    PREFERENCE_BLOB_KEYS.has(storeKey) ||
    PREFERENCE_BLOB_PREFIXES.some((p) => storeKey.startsWith(p))
  );
}

// Keys reconciled (merged with the cloud row) in this page session. A
// fresh record of the same key (another idle edit) re-arms it.
const reconciled = new Set<string>();
const listeners = new Set<(storeKey: string) => void>();

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(UNSYNCED_BLOBS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function write(keys: string[]): void {
  try {
    if (keys.length === 0) window.localStorage.removeItem(UNSYNCED_BLOBS_KEY);
    else window.localStorage.setItem(UNSYNCED_BLOBS_KEY, JSON.stringify(keys));
  } catch {
    /* storage blocked: the in-memory dirty flag is all we have */
  }
}

/** A local edit to `storeKey` landed while sync wasn't running. */
export function recordUnsyncedBlob(storeKey: string): void {
  if (typeof window === "undefined") return;
  reconciled.delete(storeKey);
  const keys = read();
  if (!keys.includes(storeKey)) {
    keys.push(storeKey);
    write(keys);
  }
  listeners.forEach((l) => l(storeKey));
}

/** Pushed: the cloud has this key's local edits. */
export function clearUnsyncedBlob(storeKey: string): void {
  if (typeof window === "undefined") return;
  reconciled.delete(storeKey);
  const keys = read();
  const i = keys.indexOf(storeKey);
  if (i === -1) return;
  keys.splice(i, 1);
  write(keys);
}

/** Recorded and not yet merged with the cloud row in this page session. */
export function needsBlobReconcile(storeKey: string): boolean {
  if (typeof window === "undefined") return false;
  return !reconciled.has(storeKey) && read().includes(storeKey);
}

export function markBlobReconciled(storeKey: string): void {
  reconciled.add(storeKey);
}

/** Any recorded key that holds work (not just UI preferences). */
export function hasUnsyncedBlobData(): boolean {
  if (typeof window === "undefined") return false;
  return read().some((k) => !isPreferenceBlob(k));
}

/** Called on every record (not only the first per key). */
export function subscribeUnsyncedBlobs(listener: (storeKey: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ───────── merge ─────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasId(v: unknown): v is { id: string | number } {
  return isPlainObject(v) && (typeof v.id === "string" || typeof v.id === "number");
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function mergeArrays(local: unknown[], remote: unknown[]): unknown[] {
  if (local.every(hasId) && remote.every(hasId)) {
    // Local wins per id; cloud-only rows are kept.
    const ids = new Set(local.map((e) => (e as { id: string | number }).id));
    return [...local, ...remote.filter((e) => !ids.has((e as { id: string | number }).id))];
  }
  if (local.every(isPrimitive) && remote.every(isPrimitive)) {
    const seen = new Set<unknown>(local);
    const extra: unknown[] = [];
    for (const v of remote) {
      if (seen.has(v)) continue;
      seen.add(v);
      extra.push(v);
    }
    return [...local, ...extra];
  }
  return local;
}

/**
 * Combine a local blob edited while signed out with the cloud row it was
 * kept apart from — what "merge into my workspace" means for blob tools.
 *
 *   - arrays of `{ id }` rows (risk register, decision log, 1:1s, …):
 *     union by id, the local row winning for an id both sides have;
 *   - arrays of primitives (favourites, dismissed ids): union;
 *   - plain objects (`{ items: [...], settings }` shaped state): merged
 *     key by key with the same rules, two levels deep, keeping cloud-only
 *     keys;
 *   - anything else: the local value (it is the newer edit).
 *
 * A row deleted locally while signed out comes back from the cloud: losing
 * a deletion is the lesser harm next to losing someone's rows.
 */
export function mergeBlobPayloads(local: unknown, remote: unknown, depth = 0): unknown {
  if (local === undefined || local === null) return remote;
  if (remote === undefined || remote === null) return local;
  if (Array.isArray(local) && Array.isArray(remote)) return mergeArrays(local, remote);
  if (isPlainObject(local) && isPlainObject(remote) && depth < 2) {
    const out: Record<string, unknown> = { ...remote };
    for (const [k, v] of Object.entries(local)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = Object.prototype.hasOwnProperty.call(remote, k)
        ? mergeBlobPayloads(v, remote[k], depth + 1)
        : v;
    }
    return out;
  }
  return local;
}
