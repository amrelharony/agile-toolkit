/**
 * Diff-based realtime sync for whiteboard objects.
 *
 * The existing `use-room` ships a full-state-broadcast pattern that
 * collapses for a board of 100+ objects (every move = 100 objects on
 * the wire). This module instead broadcasts only the changed objects
 * and uses a monotonic `version` field per object for last-write-wins
 * conflict resolution.
 *
 * Protocol — three broadcast event kinds on the room channel:
 *
 *   1. `whiteboard:patch`       — payload `{ added, updated, removed, by }`
 *                                 sent on every local mutation.
 *   2. `whiteboard:heartbeat`   — payload `{ versions: {id: ver} }` every
 *                                 ~10s for drift recovery. Receivers find
 *                                 IDs they're missing or stale on and
 *                                 request them via `whiteboard:request`.
 *   3. `whiteboard:request`     — payload `{ ids: string[] }`. Any peer
 *                                 that has those IDs answers with a patch.
 *
 * Conflict resolution is dead-simple LWW: keep the object with the
 * higher `version`. Concurrent edits to different objects merge cleanly;
 * concurrent edits to the *same* object resolve to whichever client wrote
 * last (the version field is bumped by the writer before broadcasting).
 */

import type { WhiteboardObject } from "@/lib/stores/workspace-types";

export interface WhiteboardPatch {
  /** Objects fully replaced (new objects use the same array). */
  upserted: WhiteboardObject[];
  /** Object IDs deleted by the sender. */
  removed: string[];
  /** Sender user ID — used to ignore our own echoed patches. */
  by: string;
  /** ISO timestamp — used for heartbeats / drift detection. */
  at: string;
}

export interface WhiteboardHeartbeat {
  /** Map from object ID → current version. Receivers detect drift. */
  versions: Record<string, number>;
  by: string;
  at: string;
}

export interface WhiteboardRequest {
  ids: string[];
  by: string;
}

/**
 * Compute a patch from a previous-snapshot view to a current snapshot.
 * Used by the local-change emitter to figure out what to broadcast.
 */
export function computePatch(
  prev: readonly WhiteboardObject[],
  next: readonly WhiteboardObject[],
  by: string,
): WhiteboardPatch {
  const prevById = new Map(prev.map((o) => [o.id, o]));
  const nextById = new Map(next.map((o) => [o.id, o]));
  const upserted: WhiteboardObject[] = [];
  const removed: string[] = [];
  for (const o of next) {
    const before = prevById.get(o.id);
    if (!before || before.version !== o.version) upserted.push(o);
  }
  for (const id of Array.from(prevById.keys())) {
    if (!nextById.has(id)) removed.push(id);
  }
  return { upserted, removed, by, at: new Date().toISOString() };
}

/**
 * Apply an incoming patch against a current local list. Returns the merged
 * list. Objects with an older or equal version than the local copy are
 * discarded — LWW.
 *
 * Pure function, deterministic given the inputs.
 */
export function applyPatch(
  local: readonly WhiteboardObject[],
  patch: WhiteboardPatch,
): WhiteboardObject[] {
  const map = new Map(local.map((o) => [o.id, o]));
  for (const incoming of patch.upserted) {
    const existing = map.get(incoming.id);
    if (!existing || incoming.version > existing.version) {
      map.set(incoming.id, incoming);
    }
  }
  for (const id of patch.removed) {
    map.delete(id);
  }
  return Array.from(map.values());
}

/**
 * Compare local versions against a peer's heartbeat. Returns object IDs
 * the peer claims to have at higher (or unknown-to-us) versions — the
 * receiver should then request those via `whiteboard:request`.
 */
export function detectDrift(
  local: readonly WhiteboardObject[],
  hb: WhiteboardHeartbeat,
): string[] {
  const localVer = new Map(local.map((o) => [o.id, o.version]));
  const needed: string[] = [];
  for (const [id, ver] of Object.entries(hb.versions)) {
    const lv = localVer.get(id);
    if (lv === undefined || lv < ver) needed.push(id);
  }
  return needed;
}

const HEARTBEAT_MAX_KEYS = 500;

/**
 * Build a heartbeat from the current local objects.
 *
 * Caps the keyset to {@link HEARTBEAT_MAX_KEYS} (preferring objects with
 * higher versions, i.e. recently edited ones) so that boards with
 * thousands of stickies don't blow Supabase Realtime's message-size cap
 * with a 10-second-cadence broadcast. Drift recovery on boards larger
 * than the cap will need additional patches — acceptable since older
 * un-touched objects rarely drift.
 */
export function buildHeartbeat(local: readonly WhiteboardObject[], by: string): WhiteboardHeartbeat {
  const versions: Record<string, number> = {};
  const sample = local.length <= HEARTBEAT_MAX_KEYS
    ? local
    : [...local].sort((a, b) => b.version - a.version).slice(0, HEARTBEAT_MAX_KEYS);
  for (const o of sample) versions[o.id] = o.version;
  return { versions, by, at: new Date().toISOString() };
}

/** Bump version on a single object — used by every editor before upserting. */
export function bumpVersion<T extends WhiteboardObject>(o: T, userId?: string): T {
  return {
    ...o,
    version: o.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: userId ?? o.updatedBy,
  };
}
