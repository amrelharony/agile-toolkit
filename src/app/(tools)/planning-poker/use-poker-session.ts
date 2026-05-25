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

const HEARTBEAT_MS = 5_000;

export interface PokerSessionHook {
  /** Live session state. Null before the host starts a session OR
   *  before a guest receives the first state-sync. */
  session: Session | null;
  /** Replace the session locally AND broadcast to peers. */
  setSession: (updater: Session | ((prev: Session | null) => Session | null)) => void;
  /** True when the realtime channel is connected. */
  isConnected: boolean;
  /** True when Supabase realtime is unavailable. */
  isLocalOnly: boolean;
  /** Stable per-peer id (localStorage-backed via useRoom). */
  userId: string;
}

export function usePokerSession(roomCode: string | null, isHost: boolean): PokerSessionHook {
  const [session, setLocalSession] = useState<Session | null>(null);

  // We don't use useRoom's state-sync channel — pass a validateState
  // that rejects everything so a hostile peer can't spam the channel.
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

  // Inbound: validate, then replace local state. Skip self-echoes
  // (`env.by === me`). When the LOCAL participant is the host, refuse
  // to accept host-only mutations originating from a non-host peer —
  // a hostile or buggy guest could otherwise broadcast a snapshot
  // with `revealed: true`, rewritten stories, or a participants list
  // missing the host. Owner-side authority on host-only fields is the
  // last line of defence; the UI's `isHost` gates only block local
  // click handlers, not the broadcast layer.
  useEffect(() => {
    if (!roomCode || room.isLocalOnly) return;
    const off = roomRef.current.subscribeToEvent("poker:state", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const env = raw as { state?: unknown; by?: unknown };
      if (typeof env.by === "string" && env.by === roomRef.current.userId) return;
      if (!isValidSession(env.state)) return;
      const next = env.state;
      const senderIsHost = typeof env.by === "string" && env.by === next.hostId;
      setLocalSession((prev) => {
        if (!isHost || !prev || senderIsHost) return next;
        // We're the host; merge the incoming change but preserve
        // host-only fields from our own state. Allowed peer changes:
        // their OWN participant entry (vote / display name). All other
        // shape changes (stories, currentStoryIdx, revealed, host,
        // hostId) come from the host.
        if (typeof env.by !== "string") return prev;
        const senderId = env.by;
        const ours = new Map(prev.participants.map((p) => [p.id, p]));
        for (const p of next.participants) {
          // Only let the sender mutate their own row, or add themselves
          // as a new participant. Other rows are preserved from `prev`.
          if (p.id === senderId) {
            ours.set(p.id, { ...p });
          } else if (!ours.has(p.id)) {
            // Ignore: peers cannot introduce other participants.
          }
        }
        return {
          ...prev,
          participants: Array.from(ours.values()),
        };
      });
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, room.isLocalOnly, isHost]);

  // Heartbeat: host re-broadcasts every HEARTBEAT_MS so late joiners
  // converge without requiring the host to make a UI change.
  useEffect(() => {
    if (!isHost || !roomCode || room.isLocalOnly) return;
    if (!room.isConnected) return;
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (!s) return;
      roomRef.current.broadcast("poker:state", {
        state: s,
        by: roomRef.current.userId,
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, roomCode, room.isLocalOnly, room.isConnected]);

  // Host-side ghost cleanup: when a participant's realtime presence
  // drops (tab close, navigate away, network blip), prune their entry
  // from the session and re-broadcast. Without this, a guest who closes
  // their tab without clicking Leave leaves a phantom participant with
  // a stuck vote — Reveal's "N/M voted" counter never tips over.
  //
  // The host's own row stays regardless of presence: the host's
  // `track()` may not have completed yet on the very first render, and
  // we never want the host to prune themselves.
  useEffect(() => {
    if (!isHost || !roomCode || room.isLocalOnly) return;
    if (!room.isConnected) return;
    const present = new Set(room.members.map((m) => m.id));
    const prev = sessionRef.current;
    if (!prev) return;
    const keep = prev.participants.filter((p) => p.id === prev.hostId || present.has(p.id));
    if (keep.length === prev.participants.length) return;
    // Use setSession (not setLocalSession) so the prune broadcasts to
    // remaining peers — their participant lists converge too.
    setSession({ ...prev, participants: keep });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, roomCode, room.isLocalOnly, room.isConnected, room.members]);

  const setSession = useCallback(
    (updater: Session | ((prev: Session | null) => Session | null)) => {
      setLocalSession((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (p: Session | null) => Session | null)(prev)
            : updater;
        if (next && !roomRef.current.isLocalOnly) {
          roomRef.current.broadcast("poker:state", {
            state: next,
            by: roomRef.current.userId,
          });
        }
        return next;
      });
    },
    []
  );

  return {
    session,
    setSession,
    isConnected: room.isConnected,
    isLocalOnly: room.isLocalOnly,
    userId: room.userId,
  };
}
