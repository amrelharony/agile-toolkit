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

import { useCallback, useEffect, useRef, useState } from "react";
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
import { isValidObject, MAX_ID_LEN, MAX_COORD, MAX_VERSION } from "./object-validator";

const HEARTBEAT_MS = 10_000;
/** Random jitter ceiling for drift-recovery requests. Each peer that
 * notices drift waits 0…N ms before sending a `whiteboard:request`,
 * and cancels its own request if it sees somebody else's first. This
 * prevents N peers from each blasting the same ID list back at the
 * source after a single heartbeat. */
const DRIFT_REQUEST_JITTER_MS = 400;
/** Tolerance window for past `expiresAt` on spotlight broadcasts. Without
 * this, a peer whose clock is even a few seconds behind ours will see
 * legitimate spotlight events as already-expired and silently drop them.
 * 30 s comfortably covers typical NTP drift. */
const SPOTLIGHT_PAST_TOLERANCE_MS = 30_000;

// ─── Runtime payload guards ─────────────────────────────────────────────
// Remote peers can in principle send anything on the channel (compromised
// account, mismatched client version, browser extension injecting traffic).
// Guard each broadcast type before trusting it — a malformed message
// should be dropped, not crash the receiver.
//
// The object-shape check (`isValidObject`) lives in `./object-validator`
// so the clipboard / drag-drop ingest paths run the SAME check — a
// payload that the realtime layer would reject is also rejected at paste
// time, and vice versa.

function isValidPatch(raw: unknown): raw is WhiteboardPatch {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.by !== "string" || r.by.length === 0 || r.by.length > MAX_ID_LEN) return false;
  // `at` is required by the WhiteboardPatch contract and stamped by
  // computePatch. Bound to a sane string length so a hostile peer
  // can't blow memory with a 50 MB ISO timestamp.
  if (typeof r.at !== "string" || r.at.length === 0 || r.at.length > 64) return false;
  if (!Array.isArray(r.upserted) || !Array.isArray(r.removed)) return false;
  // Cap the payload to avoid memory blow-up via a hostile peer.
  if (r.upserted.length > 5_000 || r.removed.length > 5_000) return false;
  for (const id of r.removed) {
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LEN) return false;
  }
  for (const o of r.upserted) {
    if (!isValidObject(o)) return false;
  }
  return true;
}

function isValidHeartbeat(raw: unknown): raw is WhiteboardHeartbeat {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.by !== "string" || r.by.length === 0 || r.by.length > MAX_ID_LEN) return false;
  // `at` is required by the WhiteboardHeartbeat contract.
  if (typeof r.at !== "string" || r.at.length === 0 || r.at.length > 64) return false;
  if (!r.versions || typeof r.versions !== "object") return false;
  const vs = r.versions as Record<string, unknown>;
  const keys = Object.keys(vs);
  if (keys.length > 5_000) return false;
  for (const k of keys) {
    // Cap key length so a hostile peer can't blow memory with one
    // 50 MB key — same threat model as MAX_ID_LEN on object IDs.
    if (k.length === 0 || k.length > MAX_ID_LEN) return false;
    const v = vs[k];
    // Versions must be non-negative integers ≤ uint32. Without
    // Number.isInteger, a peer can send `2.5` and pass Number.isFinite;
    // without the MAX_VERSION cap (vs MAX_SAFE_INTEGER) a peer can
    // send 2^53-1, after which no future writer can win the LWW
    // comparison — the targeted object is locked forever (denial-of-
    // -write attack).
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_VERSION) return false;
  }
  return true;
}

function isValidRequest(raw: unknown): raw is WhiteboardRequest {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.by !== "string" || r.by.length === 0 || r.by.length > MAX_ID_LEN) return false;
  if (!Array.isArray(r.ids) || r.ids.length > 5_000) return false;
  for (const id of r.ids) {
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LEN) return false;
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
  /** When true, this peer is in viewer/commenter mode — it RECEIVES
   * patches and presence but does NOT broadcast local store mutations.
   * Defense-in-depth against a hostile browser extension that flips
   * `readOnly` in the UI but can't suppress the broadcast effect. */
  readOnly?: boolean;
}

export interface FocusBroadcast {
  /** World coords + size of the focus rect. */
  rect: { x: number; y: number; w: number; h: number };
  /** Sender — receivers ignore their own broadcasts. */
  by: string;
  /** Kind: "snap" forces the camera to fit-to-rect; "spotlight"
   * dims the surround but doesn't move the camera. */
  kind: "snap" | "spotlight";
  /** ISO timestamp. */
  at: string;
  /** Spotlight auto-clears after this epoch-ms; ignored for "snap". */
  expiresAt?: number;
}

function isValidFocus(raw: unknown): raw is FocusBroadcast {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.by !== "string" || r.by.length === 0 || r.by.length > MAX_ID_LEN) return false;
  if (r.kind !== "snap" && r.kind !== "spotlight") return false;
  if (!r.rect || typeof r.rect !== "object") return false;
  const rect = r.rect as Record<string, unknown>;
  // Reject NaN/Infinity AND magnitudes outside world bounds. Without
  // this, a hostile peer broadcasts {x:1e308,y:1e308}; fitToRects
  // divides by these and produces zoom ≈ 0 / NaN → recipients lose
  // their camera state with no recovery short of a page reload.
  if (
    typeof rect.x !== "number" || !Number.isFinite(rect.x) || Math.abs(rect.x) > MAX_COORD ||
    typeof rect.y !== "number" || !Number.isFinite(rect.y) || Math.abs(rect.y) > MAX_COORD ||
    typeof rect.w !== "number" || !Number.isFinite(rect.w) || rect.w <= 0 || rect.w > MAX_COORD ||
    typeof rect.h !== "number" || !Number.isFinite(rect.h) || rect.h <= 0 || rect.h > MAX_COORD
  ) return false;
  // Spotlight must have a roughly-future expiresAt and can't camp on
  // screen forever (cap at 60s). Snap doesn't use expiresAt.
  //
  // We allow `expiresAt` to be up to SPOTLIGHT_PAST_TOLERANCE_MS in the
  // past — peers with NTP drift commonly diverge by 5–15 s, and without
  // the tolerance we silently drop perfectly legitimate spotlights from
  // those peers. The receive-side TTL effect treats negative TTLs as
  // already-expired and clears immediately, so accepting a slightly-past
  // expiresAt is safe.
  if (r.kind === "spotlight") {
    if (typeof r.expiresAt !== "number" || !Number.isFinite(r.expiresAt)) return false;
    const now = Date.now();
    if (r.expiresAt < now - SPOTLIGHT_PAST_TOLERANCE_MS || r.expiresAt > now + 60_000) return false;
  }
  return true;
}

export function useCanvasRoom({ toolId = "canvas", roomId, boardId, readOnly = false }: CanvasRoomOptions): {
  isConnected: boolean;
  userId: string;
  /** Broadcast a "follow me" / "look here" event to peers. `snap` is
   * the "Bring everyone to me" gesture — peers' cameras fit to the
   * supplied rect. `spotlight` highlights the rect without moving
   * peer cameras. */
  broadcastFocus: (kind: "snap" | "spotlight", rect: { x: number; y: number; w: number; h: number }) => void;
  /** Peer focus event from realtime. Receivers use this to render
   * the spotlight overlay or snap their camera. */
  remoteFocus: FocusBroadcast | null;
} {
  // We don't use the `state-sync` channel — all cross-peer data flows
  // through our own validated `whiteboard:*` broadcast events. By passing
  // a `validateState` that always rejects, a hostile peer can't trigger
  // `setStateInternal` re-renders or bloat `latestStateRef` by spamming
  // `state-sync` payloads on the canvas channel. The validator runs on
  // every incoming `state-sync`, so dropping them here is the cheapest
  // possible defense (no React commit, no ref-write, no memory growth).
  const room = useRoom<unknown>(toolId, roomId, null, {
    validateState: (_raw): _raw is unknown => false,
  });
  const upsertMany = useWorkspaceStore((s) => s.upsertWhiteboardObjects);
  const removeMany = useWorkspaceStore((s) => s.removeWhiteboardObjects);
  const [remoteFocus, setRemoteFocus] = useState<FocusBroadcast | null>(null);

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

    // ─── Inbound-patch coalescer ──────────────────────────────────────
    // Each incoming `whiteboard:patch` triggers an `applyPatch` against
    // the live local list (a Map rebuild over up to 1000 objects) plus a
    // pair of workspace-store mutations (each a full React re-render of
    // every workspace-store subscriber). With 5 peers each broadcasting
    // at the 10 patches/sec ceiling, that's 50 patch-applies/sec → 50
    // store re-renders/sec.
    //
    // We instead queue incoming patches into a buffer and flush via
    // rAF (≤60 Hz, naturally aligned to render cadence) — multiple
    // patches landing in the same frame are merged before they touch
    // the store, so even 5 peers contribute at most ONE store mutation
    // per frame regardless of inbound rate. LWW semantics survive
    // because `applyPatch` is order-independent in its result (the
    // higher version wins regardless of arrival order).
    const inboundQueue: WhiteboardPatch[] = [];
    let flushRaf: ReturnType<typeof requestAnimationFrame> | null = null;
    const flushInbound = () => {
      flushRaf = null;
      if (inboundQueue.length === 0) return;
      const batch = inboundQueue.splice(0, inboundQueue.length);
      // Snapshot the live list ONCE and fold every queued patch into it.
      // The per-patch board-filter + boardId guard already ran on
      // ingest; here we just apply the merge.
      let merged = (useWorkspaceStore.getState().whiteboardObjects ?? []).filter(
        (o) => o.boardId === boardId,
      );
      const localById = new Map(merged.map((o) => [o.id, o]));
      // Accumulate "what each patch wanted to remove" so the final
      // ownership check in applyPatch still runs once per patch (each
      // patch can carry its own `by` author for the removal-permission
      // check). applyPatch is pure so we just keep folding it.
      for (const patch of batch) {
        merged = applyPatch(merged, patch);
      }
      const toUpsert: WhiteboardObject[] = [];
      for (const o of merged) {
        const existing = localById.get(o.id);
        if (!existing || existing.version !== o.version) toUpsert.push(o);
      }
      const toRemoveSet = new Set(localById.keys());
      for (const o of merged) toRemoveSet.delete(o.id);
      const toRemove = Array.from(toRemoveSet);
      // CRITICAL: update the broadcast snapshot BEFORE the store
      // mutation. See same rationale below — the local-broadcast
      // listener fires on the resulting state change and would
      // otherwise compute a delta that mirrors the incoming patches
      // back to peers (echo loop).
      for (const o of merged) lastBroadcastRef.current.set(o.id, o);
      for (const id of toRemove) lastBroadcastRef.current.delete(id);
      if (toUpsert.length > 0) upsertMany(toUpsert);
      if (toRemove.length > 0) removeMany(toRemove);
    };

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
      // Queue + schedule the flush. The same rAF will drain everything
      // that lands in the next frame window — across all 5 peers, a
      // single 16 ms window can absorb their entire combined rate.
      inboundQueue.push({ ...patch, upserted });
      if (flushRaf === null) {
        // requestAnimationFrame is undefined during SSR / Jest — fall
        // back to a microtask boundary so tests still flush deterministically.
        flushRaf = typeof requestAnimationFrame !== "undefined"
          ? requestAnimationFrame(flushInbound)
          : (Promise.resolve().then(flushInbound), 1 as unknown as ReturnType<typeof requestAnimationFrame>);
      }
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

    // ─── whiteboard:focus — "Bring everyone to me" / "Spotlight" ───
    // Host emits a focus rect; peers either snap their camera (kind
    // === "snap") or render a dimmed spotlight overlay (kind ===
    // "spotlight"). Spotlight auto-clears at `expiresAt`.
    const offFocus = roomRef.current.subscribeToEvent("whiteboard:focus", (raw) => {
      if (!isValidFocus(raw)) return;
      const me = roomRef.current.userId;
      if (raw.by === me) return; // ignore our own echo
      setRemoteFocus(raw);
    });

    return () => {
      offPatch();
      offHeartbeat();
      offRequest();
      offFocus();
      if (driftTimer !== null) clearTimeout(driftTimer);
    };
    // NOTE: we intentionally omit `room` from the dep list — it's a new
    // object every render. We read through roomRef.current instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, room.isLocalOnly, boardId, upsertMany, removeMany]);

  // Spotlight auto-clear: when `remoteFocus.expiresAt` passes, drop
  // the local state so the overlay disappears even if no follow-up
  // event arrives. Snap events don't expire (they're one-shot).
  useEffect(() => {
    if (!remoteFocus || remoteFocus.kind !== "spotlight") return;
    const ttl = (remoteFocus.expiresAt ?? Date.now()) - Date.now();
    if (ttl <= 0) { setRemoteFocus(null); return; }
    const h = setTimeout(() => setRemoteFocus(null), ttl);
    return () => clearTimeout(h);
  }, [remoteFocus]);

  // Public helper — wraps the broadcast event with sender stamping.
  const broadcastFocus = useCallback(
    (kind: "snap" | "spotlight", rect: { x: number; y: number; w: number; h: number }) => {
      if (!roomRef.current) return;
      // ReadOnly tier (viewer / commenter) cannot drive peer cameras.
      // Without this gate, a hostile viewer would be able to spam
      // `snap` events and lock every editor's camera onto irrelevant
      // rects — a denial-of-collaboration vector.
      if (readOnly) return;
      // Clamp the outgoing rect into the validator's accepted range so
      // a local pathological zoom (camera.zoom = 0.0005 → rect.w = size*2000)
      // doesn't produce a payload that peers reject AND wreck their
      // cameras on the way through. Width / height must stay positive
      // AND be large enough to produce a usable spotlight (a 1-unit
      // rect produces zoom ≈ viewport_size / 1 on receivers).
      const safeRect = {
        x: Math.max(-MAX_COORD, Math.min(MAX_COORD, rect.x)),
        y: Math.max(-MAX_COORD, Math.min(MAX_COORD, rect.y)),
        w: Math.max(100, Math.min(MAX_COORD, rect.w)),
        h: Math.max(100, Math.min(MAX_COORD, rect.h)),
      };
      const payload: FocusBroadcast = {
        rect: safeRect,
        by: roomRef.current.userId,
        kind,
        at: new Date().toISOString(),
        ...(kind === "spotlight" ? { expiresAt: Date.now() + 8_000 } : {}),
      };
      roomRef.current.broadcast("whiteboard:focus", payload);
    },
    [readOnly],
  );

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
    // ReadOnly tier (viewer / commenter): never broadcast local
    // mutations. Even if a UI handler bypasses its `readOnly` gate, the
    // network-side broadcast effect is silent. Receive paths still run.
    if (readOnly) return;
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
  }, [roomId, room.isLocalOnly, boardId, readOnly]);

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

  return {
    isConnected: room.isConnected,
    userId: room.userId,
    broadcastFocus,
    remoteFocus,
  };
}
