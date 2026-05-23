/**
 * Last-write-wins primitives shared by the blob and entity sync adapters.
 *
 * The single-user model means concurrent edits across two devices are
 * rare; when they happen, the one with the newer timestamp wins. The
 * timestamps are server-stamped on Supabase (the `updated_at` default
 * `now()`), so device clock skew can't manufacture a fake "newer" write
 * — only the order of arrival at the database matters.
 */

export interface Timestamped {
  updated_at: string; // ISO8601 from Postgres timestamptz
}

/** Compare two ISO timestamps. Returns >0 if a is newer, <0 if b is newer, 0 if equal. */
export function compareIso(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return ta - tb;
}

/** Returns the side with the strictly-newer timestamp. Ties favour `b`
 *  (the incoming/remote side) — the caller usually wants the network's
 *  view to be authoritative on equality. */
export function lwwPick<T extends Timestamped>(a: T, b: T): T {
  return compareIso(b.updated_at, a.updated_at) >= 0 ? b : a;
}

/** Generate a stable per-tab client id. Used to ignore realtime echoes
 *  of our own writes. nanoid is already a project dependency. */
import { nanoid } from "nanoid";

let cachedClientId: string | null = null;

export function getClientId(): string {
  if (cachedClientId) return cachedClientId;
  if (typeof window === "undefined") {
    // SSR path: any unique value works; this branch is never used to push.
    cachedClientId = `ssr:${nanoid(8)}`;
    return cachedClientId;
  }
  // Per-tab id, not per-device. Each open tab gets its own; that's
  // intentional — if you open two tabs of the canvas on the same machine,
  // changes from tab A should still surface in tab B via realtime.
  cachedClientId = `c_${nanoid(12)}`;
  return cachedClientId;
}
