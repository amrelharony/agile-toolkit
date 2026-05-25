"use client";

/**
 * Realtime sync for a Planning Poker session.
 *
 * Protocol: every local `setSession` broadcasts the full Session on
 * `poker:state`. Every received `poker:state` whose body validates is
 * applied to local state. Full-state sync — poker sessions are small
 * and the semantics (vote, reveal, advance) are inherently convergent.
 *
 * Late-joining peers: the host re-broadcasts the current session every
 * 5 s as a keepalive. A guest joining mid-session picks it up within
 * one heartbeat (same recovery model as canvas's `whiteboard:heartbeat`).
 *
 * The hook deliberately doesn't use `useRoom`'s built-in `state` /
 * `setState` channel — that path was designed for tools that have an
 * initial state at mount and broadcast on every change. The poker
 * session is constructed on the fly when the host clicks "Start" in
 * the lobby; trying to thread a freshly-built initial state into
 * `useRoom`'s state-sync requires a setTimeout dance. Direct event
 * broadcast keeps the lifecycle explicit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRoom } from "@/lib/realtime/use-room";
import { isValidSession, type Session } from "./types";
import {
  mergePokerState,
  clampCurrentStoryIdx,
  preserveHostOnlyFields,
  redactVotesForBroadcast,
  electNewHost,
} from "./merge";

const HEARTBEAT_MS = 5_000;
const HOST_MIGRATION_DELAY_MS = 10_000;

export interface PokerSessionHook {
  /** Live session state. Null before the host starts a session OR
   *  before a guest receives the first state-sync. */
  session: Session | null;
  /** Replace the session locally AND broadcast to peers. When the local
   *  participant is not the effective host, host-only fields are
   *  preserved from `prev` (the broadcast layer enforces the model). */
  setSession: (updater: Session | ((prev: Session | null) => Session | null)) => void;
  /** True when the realtime channel is connected. */
  isConnected: boolean;
  /** True when Supabase realtime is unavailable. */
  isLocalOnly: boolean;
  /** Stable per-peer id (localStorage-backed via useRoom). */
  userId: string;
  /** Effective host flag — true if the caller passed `isHost=true` OR
   *  if we got promoted via host migration after the original host
   *  disconnected. Callers should pass this to SessionScreen's `isHost`
   *  prop so the UI updates after promotion. */
  isHost: boolean;
  /** Broadcast a "host is leaving" signal so guests can render an
   *  affordance immediately rather than waiting for heartbeat silence. */
  broadcastSessionEnded: () => void;
  /** Subscribe to the host's "leaving" signal. */
  subscribeToSessionEnded: (handler: () => void) => () => void;
}

export function usePokerSession(roomCode: string | null, isHost: boolean): PokerSessionHook {
  const [session, setLocalSession] = useState<Session | null>(null);
  const [promoted, setPromoted] = useState(false);
  const effectiveIsHost = isHost || promoted;

  const room = useRoom<unknown>("planning-poker", roomCode, null, {
    validateState: (_raw): _raw is unknown => false,
  });

  // Stash the latest room in a ref so the effects don't have to depend
  // on `room` itself. useRoom returns a fresh object every render, so
  // putting `room` in a dep array would tear down and re-create the
  // subscription + interval on every parent re-render — the heartbeat
  // would be cleared before its 5 s elapses and never fire. Mirrors the
  // pattern in `src/lib/whiteboard/use-canvas-room.ts:247-253`.
  const roomRef = useRef(room);
  roomRef.current = room;

  // sessionRef is read by the heartbeat interval without re-creating
  // the effect on every state change.
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;

  const effectiveIsHostRef = useRef(effectiveIsHost);
  effectiveIsHostRef.current = effectiveIsHost;

  const trustedHostIdRef = useRef<string | null>(null);
  const electedHostIdRef = useRef<string | null>(null);
  // Tracks the wall-clock time the trusted host was first noticed
  // absent from presence. The migration timer fires at +10s from this
  // anchor, not from "current effect run" — otherwise an unrelated
  // member change (a guest joining) restarts the clock.
  const hostAbsentSinceRef = useRef<number | null>(null);

  // Reset promotion when room code changes — a new room means a fresh
  // host election state.
  useEffect(() => {
    setPromoted(false);
    electedHostIdRef.current = null;
    trustedHostIdRef.current = null;
    hostAbsentSinceRef.current = null;
  }, [roomCode]);

  // Reconnect-race guard: skip the prune effect until presence has
  // actually synced at least once on the current channel. Without this,
  // the moment `isConnected` flips true (before the first sync event)
  // members is `[]` and the prune wipes every guest from the host's
  // local state.
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    if (!room.isConnected) {
      hasSyncedRef.current = false;
      return;
    }
    if (room.members.length > 0) {
      hasSyncedRef.current = true;
    }
  }, [room.isConnected, room.members]);

  // Inbound: validate, then merge. The merge rejects host-only field
  // mutations from non-host peers (both for the host receiver and for
  // guests) and bounds votes to the active scale.
  useEffect(() => {
    if (!roomCode || room.isLocalOnly) return;
    const off = roomRef.current.subscribeToEvent("poker:state", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const env = raw as { state?: unknown; by?: unknown };
      if (typeof env.by === "string" && env.by === roomRef.current.userId) return;
      if (!isValidSession(env.state)) return;
      const next = env.state;
      const envBy = typeof env.by === "string" ? env.by : null;
      const members = roomRef.current.members;
      const presentMemberIds = new Set(members.map((m) => m.id));
      // If the trusted host is not in presence, accept a hostId change
      // from whichever peer the deterministic election picks — every
      // receiver runs the same computation so the new host's broadcast
      // converges across peers without waiting for each receiver's
      // migration timer to fire.
      let elected = electedHostIdRef.current;
      const trusted = trustedHostIdRef.current;
      if (elected === null && trusted !== null && !presentMemberIds.has(trusted)) {
        const newHost = electNewHost(members, trusted);
        if (newHost) elected = newHost.id;
      }
      setLocalSession((prev) => {
        const merged = mergePokerState({
          prev,
          next,
          envBy,
          trustedHostId: trustedHostIdRef.current,
          presentMemberIds,
          receiverId: roomRef.current.userId,
          electedHostId: elected,
        });
        if (merged) {
          trustedHostIdRef.current = merged.hostId;
          if (electedHostIdRef.current && merged.hostId === electedHostIdRef.current) {
            electedHostIdRef.current = null;
          }
        }
        return merged;
      });
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, room.isLocalOnly]);

  // Heartbeat: effective host re-broadcasts every HEARTBEAT_MS so late
  // joiners converge without requiring the host to make a UI change.
  // Broadcast payload is redacted pre-reveal — votes never traverse the
  // wire in cleartext via the host's heartbeat.
  useEffect(() => {
    if (!effectiveIsHost || !roomCode || room.isLocalOnly) return;
    if (!room.isConnected) return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      roomRef.current.broadcast("poker:state", {
        state: redactVotesForBroadcast(s, roomRef.current.userId),
        by: roomRef.current.userId,
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveIsHost, roomCode, room.isLocalOnly, room.isConnected]);

  // Host-side ghost cleanup: when a participant's realtime presence
  // drops (tab close, navigate away, network blip), prune their entry
  // from the session and re-broadcast. The host's own row stays
  // regardless of presence: the host's `track()` may not have completed
  // yet on the very first render, and we never want the host to prune
  // themselves.
  useEffect(() => {
    if (!effectiveIsHost || !roomCode || room.isLocalOnly) return;
    if (!room.isConnected) return;
    if (!hasSyncedRef.current) return;
    if (room.members.length === 0) return;
    const present = new Set(room.members.map((m) => m.id));
    const prev = sessionRef.current;
    if (!prev) return;
    const keep = prev.participants.filter((p) => p.id === prev.hostId || present.has(p.id));
    if (keep.length === prev.participants.length) return;
    setSession({ ...prev, participants: keep });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveIsHost, roomCode, room.isLocalOnly, room.isConnected, room.members]);

  // Host migration: if the trusted host has been absent from members
  // for >HOST_MIGRATION_DELAY_MS, the earliest-joined remaining peer
  // (by `joinedAt`) promotes itself. The election is deterministic so
  // all peers independently update their trustedHostId to the same
  // candidate; the new host's broadcasts then pass the merge defence.
  useEffect(() => {
    if (!roomCode || room.isLocalOnly) return;
    if (!room.isConnected) return;
    if (!hasSyncedRef.current) return;
    const s = sessionRef.current;
    if (!s) return;
    const trusted = trustedHostIdRef.current ?? s.hostId;
    if (room.members.some((m) => m.id === trusted)) {
      electedHostIdRef.current = null;
      hostAbsentSinceRef.current = null;
      return;
    }
    const newHost = electNewHost(room.members, trusted);
    if (!newHost) return;
    if (hostAbsentSinceRef.current === null) {
      hostAbsentSinceRef.current = Date.now();
    }
    const remaining = Math.max(
      0,
      HOST_MIGRATION_DELAY_MS - (Date.now() - hostAbsentSinceRef.current)
    );
    const timer = setTimeout(() => {
      const stillMissing = !roomRef.current.members.some((m) => m.id === trusted);
      if (!stillMissing) return;
      const reelected = electNewHost(roomRef.current.members, trusted);
      if (!reelected) return;
      electedHostIdRef.current = reelected.id;
      if (reelected.id === roomRef.current.userId) {
        // Update the ref synchronously so the setSession call below
        // takes the host branch (skips preserveHostOnlyFields). React's
        // setPromoted batches into the next render, but the ref has to
        // reflect the new authority right now.
        effectiveIsHostRef.current = true;
        setPromoted(true);
        const cur = sessionRef.current;
        if (cur) {
          setSession({ ...cur, hostId: reelected.id, host: reelected.name });
        }
      } else {
        trustedHostIdRef.current = reelected.id;
      }
    }, remaining);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, room.isLocalOnly, room.isConnected, room.members]);

  const setSession = useCallback(
    (updater: Session | ((prev: Session | null) => Session | null)) => {
      setLocalSession((prev) => {
        let next =
          typeof updater === "function"
            ? (updater as (p: Session | null) => Session | null)(prev)
            : updater;
        if (next && prev && !effectiveIsHostRef.current) {
          next = preserveHostOnlyFields(prev, next);
        }
        if (next) {
          next = clampCurrentStoryIdx(next);
        }
        if (next && !roomRef.current.isLocalOnly) {
          roomRef.current.broadcast("poker:state", {
            state: redactVotesForBroadcast(next, roomRef.current.userId),
            by: roomRef.current.userId,
          });
        }
        if (next) {
          trustedHostIdRef.current = next.hostId;
        } else {
          trustedHostIdRef.current = null;
        }
        return next;
      });
    },
    []
  );

  const broadcastSessionEnded = useCallback(() => {
    if (!roomRef.current.isLocalOnly) {
      roomRef.current.broadcast("poker:session-ended", {
        by: roomRef.current.userId,
      });
    }
  }, []);

  const subscribeToSessionEnded = useCallback((handler: () => void) => {
    return roomRef.current.subscribeToEvent("poker:session-ended", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const env = raw as { by?: unknown };
      if (typeof env.by !== "string") return;
      // Only the trusted host can declare the session ended.
      if (env.by !== trustedHostIdRef.current) return;
      handler();
    });
  }, []);

  return {
    session,
    setSession,
    isConnected: room.isConnected,
    isLocalOnly: room.isLocalOnly,
    userId: room.userId,
    isHost: effectiveIsHost,
    broadcastSessionEnded,
    subscribeToSessionEnded,
  };
}
