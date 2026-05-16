"use client";

/**
 * Canvas-room hook: glues the diff-sync layer to a Supabase room.
 *
 * Responsibilities:
 *   1. Subscribe to `whiteboard:patch` / `whiteboard:heartbeat` /
 *      `whiteboard:request` from peers and merge into the workspace store.
 *   2. Watch the workspace store's `whiteboardObjects` for this board, and
 *      on every local change emit a `whiteboard:patch` containing only
 *      the diff vs the previous snapshot.
 *   3. Emit a heartbeat every 10s for drift recovery.
 *   4. Respond to peers' `whiteboard:request` for specific IDs.
 *
 * Uses `useRoom`'s primitive event channel — we don't use its built-in
 * `setState` / state-sync at all (that's the full-state pattern we're
 * replacing).
 */

import { useEffect, useRef } from "react";
import { useRoom } from "@/lib/realtime/use-room";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import {
  applyPatch,
  buildHeartbeat,
  computePatch,
  detectDrift,
  type WhiteboardHeartbeat,
  type WhiteboardPatch,
  type WhiteboardRequest,
} from "./diff-sync";

const HEARTBEAT_MS = 10_000;
/** Random jitter ceiling for drift-recovery requests. Each peer that
 * notices drift waits 0…N ms before sending a `whiteboard:request`,
 * and cancels its own request if it sees somebody else's first. This
 * prevents N peers from each blasting the same ID list back at the
 * source after a single heartbeat. */
const DRIFT_REQUEST_JITTER_MS = 400;

// ─── Runtime payload guards ─────────────────────────────────────────────
// Remote peers can in principle send anything on the channel (compromised
// account, mismatched client version, browser extension injecting traffic).
// Guard each broadcast type before trusting it — a malformed message
// should be dropped, not crash the receiver.

/** Whitelist of valid WhiteboardObjectKind values. Hostile peers can
 * send any string for `type`; without this set, a "type: 'pwned'"
 * payload would pass validation and reach the workspace store as an
 * unrenderable ghost row. Keep in sync with the WhiteboardObjectKind
 * union in workspace-types.ts. */
const VALID_OBJECT_TYPES = new Set([
  "sticky", "rect", "ellipse", "diamond", "triangle",
  "line", "arrow", "connector", "text", "freehand",
  "image", "frame", "embed",
  "card", "kanban", "timer", "voting",
]);

function isValidObject(o: unknown): o is WhiteboardObject {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.boardId !== "string" ||
    typeof r.type !== "string" || !VALID_OBJECT_TYPES.has(r.type) ||
    typeof r.x !== "number" || !Number.isFinite(r.x) ||
    typeof r.y !== "number" || !Number.isFinite(r.y) ||
    typeof r.w !== "number" || !Number.isFinite(r.w) ||
    typeof r.h !== "number" || !Number.isFinite(r.h) ||
    typeof r.z !== "number" || !Number.isFinite(r.z) ||
    typeof r.version !== "number" || !Number.isFinite(r.version)
  ) return false;
  // Type-specific field validation. A hostile peer can send
  // `{type:"timer", durationSec:"hello"}` — the base check passes but
  // the timer renderer assumes durationSec is a finite number. We
  // reject malformed type-specific fields here so the workspace store
  // never sees garbage values.
  switch (r.type) {
    case "timer":
      if (typeof r.durationSec !== "number" || !Number.isFinite(r.durationSec) || r.durationSec < 0) return false;
      if (r.running !== undefined && typeof r.running !== "boolean") return false;
      if (r.startedAt !== undefined && (typeof r.startedAt !== "number" || !Number.isFinite(r.startedAt))) return false;
      if (r.remainingSec !== undefined && (typeof r.remainingSec !== "number" || !Number.isFinite(r.remainingSec))) return false;
      if (r.label !== undefined && typeof r.label !== "string") return false;
      break;
    case "voting":
      if (typeof r.question !== "string") return false;
      if (!Array.isArray(r.options)) return false;
      if (r.options.some((opt: unknown) => typeof opt !== "string" || (opt as string).length > 100)) return false;
      if (r.options.length > 50) return false; // cap option count
      if (typeof r.votes !== "object" || r.votes === null) return false;
      // Votes is a record of voterId → choice. Verify each entry.
      for (const [k, v] of Object.entries(r.votes as Record<string, unknown>)) {
        if (typeof k !== "string" || typeof v !== "string") return false;
      }
      if (typeof r.revealed !== "boolean") return false;
      break;
    case "card":
      if (typeof r.title !== "string") return false;
      if (r.description !== undefined && typeof r.description !== "string") return false;
      if (r.assignee !== undefined && typeof r.assignee !== "string") return false;
      if (r.due !== undefined && typeof r.due !== "string") return false;
      if (r.points !== undefined && (typeof r.points !== "number" || !Number.isFinite(r.points))) return false;
      if (r.status !== undefined && typeof r.status !== "string") return false;
      if (r.color !== undefined && typeof r.color !== "string") return false;
      break;
    case "kanban":
      if (typeof r.label !== "string") return false;
      if (!Array.isArray(r.columns)) return false;
      if (r.columns.some((c: unknown) => typeof c !== "string")) return false;
      if (r.columns.length > 20) return false;
      if (r.columnLabels !== undefined) {
        if (!Array.isArray(r.columnLabels)) return false;
        if ((r.columnLabels as unknown[]).some((c) => typeof c !== "string")) return false;
      }
      break;
    case "connector":
      if (typeof r.fromId !== "string" || typeof r.toId !== "string") return false;
      if (typeof r.stroke !== "string") return false;
      if (typeof r.strokeWidth !== "number" || !Number.isFinite(r.strokeWidth)) return false;
      break;
    case "freehand":
      if (!Array.isArray(r.points)) return false;
      if (r.points.length > 10_000) return false;
      if ((r.points as unknown[]).some((p) => typeof p !== "number" || !Number.isFinite(p))) return false;
      break;
    case "image":
    case "embed":
      if (typeof r.src !== "string") return false;
      if (r.src.length > 8 * 1024 * 1024) return false; // 8 MB data URL cap
      break;
  }
  return true;
}

function isValidPatch(raw: unknown): raw is WhiteboardPatch {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.by !== "string") return false;
  if (!Array.isArray(r.upserted) || !Array.isArray(r.removed)) return false;
  // Cap the payload to avoid memory blow-up via a hostile peer.
  if (r.upserted.length > 5_000 || r.removed.length > 5_000) return false;
  for (const id of r.removed) {
    if (typeof id !== "string") return false;
  }
  for (const o of r.upserted) {
    if (!isValidObject(o)) return false;
  }
  return true;
}

function isValidHeartbeat(raw: unknown): raw is WhiteboardHeartbeat {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.by !== "string") return false;
  if (!r.versions || typeof r.versions !== "object") return false;
  const vs = r.versions as Record<string, unknown>;
  const keys = Object.keys(vs);
  if (keys.length > 5_000) return false;
  for (const k of keys) {
    if (typeof vs[k] !== "number" || !Number.isFinite(vs[k] as number)) return false;
  }
  return true;
}

function isValidRequest(raw: unknown): raw is WhiteboardRequest {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.by !== "string") return false;
  if (!Array.isArray(r.ids) || r.ids.length > 5_000) return false;
  for (const id of r.ids) {
    if (typeof id !== "string") return false;
  }
  return true;
}

export interface CanvasRoomOptions {
  /** Tool ID — always "canvas" except for testing. */
  toolId?: string;
  /** Room ID — typically the board ID. `null` makes the hook a no-op (solo). */
  roomId: string | null;
  /** ID of the board this hook is syncing. */
  boardId: string;
}

export function useCanvasRoom({ toolId = "canvas", roomId, boardId }: CanvasRoomOptions): {
  isConnected: boolean;
  userId: string;
} {
  const room = useRoom<unknown>(toolId, roomId, null);
  const upsertMany = useWorkspaceStore((s) => s.upsertWhiteboardObjects);
  const removeMany = useWorkspaceStore((s) => s.removeWhiteboardObjects);

  // Snapshot of what we last broadcasted, used to compute diffs locally.
  const lastBroadcastRef = useRef<Map<string, WhiteboardObject>>(new Map());

  // Stash the latest room in a ref so the effect doesn't have to
  // depend on it. `useRoom` returns a NEW object every render — passing
  // `room` directly in the deps list re-mounts the subscription on
  // every parent re-render (every keystroke, every cursor move), which
  // tears down the Supabase listeners and re-creates them. By reading
  // through a ref, the effect only re-runs when the *roomId* or
  // *boardId* actually change.
  const roomRef = useRef(room);
  roomRef.current = room;

  // Subscribe to peer patches / heartbeats / requests. The effect only
  // mounts on board / room changes — we read the current room handle
  // via roomRef inside callbacks.
  useEffect(() => {
    if (!roomId || room.isLocalOnly) return;
    // Pending drift-recovery requests we've scheduled but not yet sent.
    // Keyed by object id. If we observe a peer ask for the same id
    // before our timer fires, we cancel — avoids the thundering-herd
    // of N peers all requesting the same drifted ids.
    const pendingDriftIds = new Set<string>();
    let driftTimer: ReturnType<typeof setTimeout> | null = null;

    const offPatch = roomRef.current.subscribeToEvent("whiteboard:patch", (raw) => {
      if (!isValidPatch(raw)) return;
      const patch = raw;
      const me = roomRef.current.userId;
      if (patch.by === me) return;
      // Filter to objects belonging to *this* board.
      const upserted = patch.upserted.filter((o) => o.boardId === boardId);
      const removed = patch.removed;
      if (upserted.length === 0 && removed.length === 0) return;
      // A peer claimed these ids — if we have pending requests for any
      // of them, the upcoming patch makes the request redundant.
      for (const o of upserted) pendingDriftIds.delete(o.id);
      const localObjects = (useWorkspaceStore.getState().whiteboardObjects ?? []).filter(
        (o) => o.boardId === boardId,
      );
      const merged = applyPatch(localObjects, { ...patch, upserted });
      const localById = new Map(localObjects.map((o) => [o.id, o]));
      const toUpsert: WhiteboardObject[] = [];
      for (const o of merged) {
        const existing = localById.get(o.id);
        if (!existing || existing.version !== o.version) toUpsert.push(o);
      }
      const toRemoveSet = new Set(localObjects.map((o) => o.id));
      for (const o of merged) toRemoveSet.delete(o.id);
      const toRemove = Array.from(toRemoveSet);
      // CRITICAL: update the broadcast snapshot BEFORE the store mutation.
      // Otherwise the workspace-store subscriber below will fire on the
      // resulting state change, see lastBroadcastRef.current still
      // pointing at the pre-merge state, compute a delta that mirrors
      // this incoming patch, and re-broadcast it back to peers — an
      // echo loop. The userId guard alone doesn't prevent that loop
      // because the re-broadcast is sent by us, not the original peer.
      //
      // Update the snapshot for the FULL merged state, not just objects
      // we're about to upsert. Patches whose remote version <= local
      // version are dropped by applyPatch (LWW), but the peer's
      // existence-of-that-version is still useful information; without
      // recording it here, subsequent local edits could compute a delta
      // that re-broadcasts a stale version against the same object id.
      for (const o of merged) lastBroadcastRef.current.set(o.id, o);
      for (const id of toRemove) lastBroadcastRef.current.delete(id);
      if (toUpsert.length > 0) upsertMany(toUpsert);
      if (toRemove.length > 0) removeMany(toRemove);
    });

    const offHeartbeat = roomRef.current.subscribeToEvent("whiteboard:heartbeat", (raw) => {
      if (!isValidHeartbeat(raw)) return;
      const hb = raw;
      const me = roomRef.current.userId;
      if (hb.by === me) return;
      const localObjects = (useWorkspaceStore.getState().whiteboardObjects ?? []).filter(
        (o) => o.boardId === boardId,
      );
      const needed = detectDrift(localObjects, hb);
      if (needed.length === 0) return;
      // Defer the request by a random 0..DRIFT_REQUEST_JITTER_MS so
      // we can cancel if another peer asks first. The cancellation
      // happens via the `pendingDriftIds.delete` calls in the
      // patch/request handlers — any concurrent observation that the
      // ids are in flight zeroes our queue. Without jitter, N peers
      // see the same heartbeat at ~the same instant and all send the
      // same request, flooding the channel.
      for (const id of needed) pendingDriftIds.add(id);
      if (driftTimer !== null) return; // batch with the pending timer
      driftTimer = setTimeout(() => {
        driftTimer = null;
        const ids = Array.from(pendingDriftIds);
        pendingDriftIds.clear();
        if (ids.length === 0) return;
        const req: WhiteboardRequest = { ids, by: roomRef.current.userId };
        roomRef.current.broadcast("whiteboard:request", req);
      }, Math.floor(Math.random() * DRIFT_REQUEST_JITTER_MS));
    });

    const offRequest = roomRef.current.subscribeToEvent("whiteboard:request", (raw) => {
      if (!isValidRequest(raw)) return;
      const req = raw;
      const me = roomRef.current.userId;
      if (req.by === me) return;
      // Suppress our pending requests for these ids — the answer is
      // about to come back from whichever peer responds.
      for (const id of req.ids) pendingDriftIds.delete(id);
      const requested = new Set(req.ids);
      const have = (useWorkspaceStore.getState().whiteboardObjects ?? []).filter(
        (o) => o.boardId === boardId && requested.has(o.id),
      );
      if (have.length === 0) return;
      const patch: WhiteboardPatch = {
        upserted: have,
        removed: [],
        by: roomRef.current.userId,
        at: new Date().toISOString(),
      };
      roomRef.current.broadcast("whiteboard:patch", patch);
    });

    return () => {
      offPatch();
      offHeartbeat();
      offRequest();
      if (driftTimer !== null) clearTimeout(driftTimer);
    };
    // NOTE: we intentionally omit `room` from the dep list — it's a new
    // object every render. We read through roomRef.current instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, room.isLocalOnly, boardId, upsertMany, removeMany]);

  // Reset the broadcast snapshot whenever the active board changes.
  // Without this, switching from board A → board B leaves the snapshot
  // populated with A's objects; the next local change on B computes a
  // diff against A (every object on A appears removed, every object on
  // B appears added) and broadcasts a huge spurious patch to peers.
  useEffect(() => {
    lastBroadcastRef.current = new Map();
  }, [boardId]);

  // Watch the workspace store for changes on this board; broadcast diffs.
  // We compare the `whiteboardObjects` array reference between snapshots —
  // every unrelated mutation (a story added in another tool, a member
  // joining, etc.) produces the same array reference and gets short-
  // circuited cheaply, so this listener only does real work on board
  // changes.
  //
  // Outbound broadcasts throttle: Supabase Realtime caps each room at
  // 10 events/sec by default. A 60-fps drag emitting one patch per
  // pointermove blows that budget instantly and Supabase silently drops
  // packets, leaving peers with phantom positions. We coalesce
  // outbound broadcasts via a microtask boundary plus a 100 ms minimum
  // gap — the latest snapshot wins, intermediate frames are skipped.
  // Peers see a smoother stream (and the in-flight gap is shorter than
  // human perception so the drag still looks live).
  const BROADCAST_MIN_GAP_MS = 100;
  useEffect(() => {
    if (!roomId || room.isLocalOnly) return;
    let prevObjectsRef = useWorkspaceStore.getState().whiteboardObjects;
    let lastSentAt = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const sendNow = () => {
      pendingTimer = null;
      lastSentAt = Date.now();
      const state = useWorkspaceStore.getState();
      const list = (state.whiteboardObjects ?? []).filter((o) => o.boardId === boardId);
      const prev = Array.from(lastBroadcastRef.current.values());
      const patch = computePatch(prev, list, roomRef.current.userId);
      if (patch.upserted.length === 0 && patch.removed.length === 0) return;
      // Update snapshot first so a self-echo via the patch handler is a no-op.
      lastBroadcastRef.current = new Map(list.map((o) => [o.id, o]));
      roomRef.current.broadcast("whiteboard:patch", patch);
    };
    const unsub = useWorkspaceStore.subscribe((state) => {
      if (state.whiteboardObjects === prevObjectsRef) return;
      prevObjectsRef = state.whiteboardObjects;
      const elapsed = Date.now() - lastSentAt;
      if (elapsed >= BROADCAST_MIN_GAP_MS) {
        sendNow();
      } else if (pendingTimer === null) {
        pendingTimer = setTimeout(sendNow, BROADCAST_MIN_GAP_MS - elapsed);
      }
    });
    return () => {
      unsub();
      if (pendingTimer !== null) clearTimeout(pendingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, room.isLocalOnly, boardId]);

  // Periodic heartbeat — only when actually connected AND tab is visible.
  // When the user backgrounds the tab (Cmd-Tab away), the heartbeat
  // continues firing every 10 s — wasting bandwidth and quota for no
  // benefit (cursor/selection aren't moving). We listen to
  // visibilitychange and skip ticks while hidden; on becoming visible
  // we fire a fresh tick immediately so peers learn what we have.
  useEffect(() => {
    if (!roomId || room.isLocalOnly || !room.isConnected) return;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const list = (useWorkspaceStore.getState().whiteboardObjects ?? []).filter(
        (o) => o.boardId === boardId,
      );
      roomRef.current.broadcast(
        "whiteboard:heartbeat",
        buildHeartbeat(list, roomRef.current.userId),
      );
    };
    tick();
    const handle = setInterval(tick, HEARTBEAT_MS);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) tick();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      stopped = true;
      clearInterval(handle);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, room.isLocalOnly, room.isConnected, boardId]);

  return { isConnected: room.isConnected, userId: room.userId };
}
