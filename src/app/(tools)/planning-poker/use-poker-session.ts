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
 * Visitor live rooms (`opts.visitor`, `visitor:planning-poker:<code>`)
 * change four things, and nothing else:
 * - the host sends the session 500 ms after someone new appears in
 *   presence, plus a 30 s keepalive, instead of the 5 s heartbeat;
 * - the host checks each payload's size first and shows a toast rather
 *   than sending one that's too big;
 * - receivers also run `isVisitorRoomSession` (this room's code, at most
 *   20 participants, visitor ids, no control or bidi characters), and the
 *   host ignores senders it removed or that are past the member cap;
 * - the host can remove someone (`kick`), every client leaves after the
 *   3-hour hard TTL, and the host is asked to keep the room open after
 *   30 minutes with no activity.
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
import { isWithinJsonSize } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS, type VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import { toast } from "@/lib/utils/toast";
import { isValidSession, type Session } from "./types";
import {
  mergePokerState,
  clampCurrentStoryIdx,
  preserveHostOnlyFields,
  redactVotesForBroadcast,
  electNewHost,
} from "./merge";
import { removePlayer } from "./players";
import { isVisitorRoomSession, toVisitorWire } from "./visitor-session";

const HEARTBEAT_MS = 5_000;
const HOST_MIGRATION_DELAY_MS = 10_000;
/** Visitor rooms: a burst of joins within this window costs one snapshot. */
const JOIN_SNAPSHOT_DEBOUNCE_MS = 500;
/** Visitor rooms: how long the idle prompt waits before the room ends. */
export const IDLE_GRACE_MS = VISITOR_LIMITS.idleGraceMs;
/** Removed members remembered per room; the oldest is forgotten past this. */
const MAX_BLOCKED = 256;

/** Why a visitor-room client stopped using the room by itself. */
export type VisitorLeaveReason =
  /** This client (the host) ended the room. */
  | "ended"
  /** The host ended the room for everyone. */
  | "host-ended"
  /** The host removed this client. */
  | "kicked"
  /** The 3-hour hard TTL ran out. */
  | "expired"
  /** The host didn't answer the idle prompt. */
  | "idle";

export interface PokerSessionOptions {
  /**
   * Join the visitor live room `visitor:planning-poker:<roomCode>` instead
   * of an owner/guest room. Needs `identity` and the feature flag; see
   * `useRoom`'s `visitor` option.
   */
  visitor?: boolean;
  /** This tab's identity in the room, from `saveVisitorIdentity`. */
  identity?: VisitorIdentity;
}

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
  /** People in the room now, this client included (at most 20 in a visitor room). */
  memberCount: number;
  /** Visitor rooms: the room already had 20 people, so this client left. */
  roomFull: boolean;
  /**
   * Visitor rooms: why this client left the room by itself. Null while it's
   * in the room, before it joins, and always for owner and guest rooms.
   * Resets when the caller passes another room code.
   */
  leftReason: VisitorLeaveReason | null;
  /**
   * Host of a visitor room: take `id`'s seat away, ignore anything they
   * send from now on, and tell them to leave. Soft: someone hostile can
   * come back under a new id. No-op anywhere else.
   */
  kick: (id: string) => void;
  /**
   * Visitor rooms: end the room (the host tells everyone first) and leave
   * it. The session stays in local state. No-op for owner and guest rooms.
   */
  endRoom: () => void;
  /**
   * Host of a visitor room: nothing has happened for
   * `VISITOR_LIMITS.idleMs`. The room ends `IDLE_GRACE_MS` later unless
   * `keepRoomOpen` is called (any change to the session also counts).
   */
  idleWarning: boolean;
  keepRoomOpen: () => void;
}

export function usePokerSession(
  roomCode: string | null,
  isHost: boolean,
  opts: PokerSessionOptions = {}
): PokerSessionHook {
  const visitor = opts.visitor === true;
  const [session, setLocalSession] = useState<Session | null>(null);
  const [promoted, setPromoted] = useState(false);
  const [leftReason, setLeftReason] = useState<VisitorLeaveReason | null>(null);
  const [idleWarning, setIdleWarning] = useState(false);
  const effectiveIsHost = isHost || promoted;
  // A visitor-room client that was removed, timed out or saw the room end
  // stops using the room on its own, whatever the caller still passes.
  const liveRoomCode = visitor && leftReason !== null ? null : roomCode;

  const room = useRoom<unknown>("planning-poker", liveRoomCode, null, {
    validateState: (_raw): _raw is unknown => false,
    visitor,
    identity: visitor ? opts.identity : undefined,
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

  const visitorRef = useRef(visitor);
  visitorRef.current = visitor;
  const roomCodeRef = useRef(roomCode);
  roomCodeRef.current = roomCode;

  const trustedHostIdRef = useRef<string | null>(null);
  const electedHostIdRef = useRef<string | null>(null);
  // Tracks the wall-clock time the trusted host was first noticed
  // absent from presence. The migration timer fires at +10s from this
  // anchor, not from "current effect run" — otherwise an unrelated
  // member change (a guest joining) restarts the clock.
  const hostAbsentSinceRef = useRef<number | null>(null);

  // Visitor rooms only. Members the host removed: their rows are ignored
  // even while they stay connected (participants keep the list too, from
  // the trusted host's kick messages).
  const blockedRef = useRef<Set<string>>(new Set());
  // Ids in presence at the last members change, to spot newcomers.
  const seenMembersRef = useRef<Set<string>>(new Set());
  const joinSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last change to the session from anyone; the idle prompt counts from it.
  const lastActivityRef = useRef(Date.now());
  // One "too big to send" toast per run of oversize sessions.
  const oversizeWarnedRef = useRef(false);

  // Reset promotion when room code changes — a new room means a fresh
  // host election state.
  useEffect(() => {
    setPromoted(false);
    setLeftReason(null);
    setIdleWarning(false);
    electedHostIdRef.current = null;
    trustedHostIdRef.current = null;
    hostAbsentSinceRef.current = null;
    blockedRef.current = new Set();
    seenMembersRef.current = new Set();
    lastActivityRef.current = Date.now();
    oversizeWarnedRef.current = false;
  }, [roomCode]);

  const rememberBlocked = useCallback((id: string) => {
    const blocked = blockedRef.current;
    blocked.delete(id);
    blocked.add(id);
    while (blocked.size > MAX_BLOCKED) {
      const oldest = blocked.values().next().value;
      if (oldest === undefined) break;
      blocked.delete(oldest);
    }
  }, []);

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdleWarning(false);
  }, []);

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

  /**
   * Broadcast `s` as this peer's `poker:state`, votes redacted pre-reveal.
   * In a visitor room the text is stripped of control and bidi characters
   * and a payload over `VISITOR_LIMITS.maxPayloadChars` isn't sent at all
   * (receivers would drop it): the sender gets a toast instead.
   */
  const sendState = useCallback((s: Session) => {
    const r = roomRef.current;
    if (r.isLocalOnly) return;
    let state = redactVotesForBroadcast(s, r.userId);
    if (visitorRef.current) {
      state = toVisitorWire(state);
      const envelope = { state, by: r.userId };
      if (!isWithinJsonSize(envelope, VISITOR_LIMITS.maxPayloadChars)) {
        if (!oversizeWarnedRef.current) {
          oversizeWarnedRef.current = true;
          toast.error("This session is too big to share live", {
            description:
              "The room isn't getting your changes. Shorten or remove some story descriptions to send it again.",
          });
        }
        return;
      }
      oversizeWarnedRef.current = false;
      r.broadcast("poker:state", envelope);
      return;
    }
    r.broadcast("poker:state", { state, by: r.userId });
  }, []);

  // Inbound: validate, then merge. The merge rejects host-only field
  // mutations from non-host peers (both for the host receiver and for
  // guests) and bounds votes to the active scale.
  useEffect(() => {
    if (!liveRoomCode || room.isLocalOnly) return;
    const off = roomRef.current.subscribeToEvent("poker:state", (raw) => {
      if (!raw || typeof raw !== "object") return;
      const env = raw as { state?: unknown; by?: unknown };
      if (typeof env.by === "string" && env.by === roomRef.current.userId) return;
      if (!isValidSession(env.state)) return;
      const next = env.state;
      const inVisitorRoom = visitorRef.current;
      if (inVisitorRoom && !isVisitorRoomSession(next, roomCodeRef.current ?? "")) return;
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
      // Visitor rooms: only seated members (presence lists at most 20) who
      // haven't been removed may change anything.
      const admit = inVisitorRoom
        ? (id: string) => presentMemberIds.has(id) && !blockedRef.current.has(id)
        : undefined;
      setLocalSession((prev) => {
        const merged = mergePokerState({
          prev,
          next,
          envBy,
          trustedHostId: trustedHostIdRef.current,
          presentMemberIds,
          receiverId: roomRef.current.userId,
          electedHostId: elected,
          admit,
        });
        if (merged) {
          trustedHostIdRef.current = merged.hostId;
          if (electedHostIdRef.current && merged.hostId === electedHostIdRef.current) {
            electedHostIdRef.current = null;
          }
        }
        // Someone else changed something: the room isn't idle. (A ref, not
        // state: the keepalive tick re-reads it and clears the prompt.)
        if (inVisitorRoom && merged !== prev) lastActivityRef.current = Date.now();
        return merged;
      });
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRoomCode, room.isLocalOnly]);

  // Heartbeat: effective host re-broadcasts every HEARTBEAT_MS so late
  // joiners converge without requiring the host to make a UI change.
  // Broadcast payload is redacted pre-reveal — votes never traverse the
  // wire in cleartext via the host's heartbeat.
  // A visitor room's host sends a 30 s keepalive instead (newcomers get a
  // snapshot from the effect below) and checks for idleness on each tick.
  useEffect(() => {
    if (!effectiveIsHost || !liveRoomCode || room.isLocalOnly) return;
    if (!room.isConnected) return;
    const id = setInterval(
      () => {
        if (visitorRef.current) {
          const idleFor = Date.now() - lastActivityRef.current;
          if (idleFor >= VISITOR_LIMITS.idleMs + IDLE_GRACE_MS) {
            roomRef.current.broadcast("poker:session-ended", { by: roomRef.current.userId });
            setIdleWarning(false);
            setLeftReason("idle");
            return;
          }
          setIdleWarning(idleFor >= VISITOR_LIMITS.idleMs);
        }
        const s = sessionRef.current;
        if (s) sendState(s);
      },
      visitor ? VISITOR_LIMITS.keepaliveMs : HEARTBEAT_MS
    );
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveIsHost, liveRoomCode, room.isLocalOnly, room.isConnected, visitor]);

  // Visitor rooms: when someone new appears in presence, the host sends
  // them the session (debounced, so a burst of joins costs one snapshot).
  useEffect(() => {
    if (!visitor || !effectiveIsHost || !liveRoomCode || room.isLocalOnly) return;
    if (!room.isConnected) return;
    const self = roomRef.current.userId;
    const ids = room.members.map((m) => m.id);
    const seen = seenMembersRef.current;
    const fresh = ids.some((id) => id !== self && !seen.has(id));
    seenMembersRef.current = new Set(ids);
    if (!fresh) return;
    if (joinSnapshotTimerRef.current !== null) clearTimeout(joinSnapshotTimerRef.current);
    joinSnapshotTimerRef.current = setTimeout(() => {
      joinSnapshotTimerRef.current = null;
      const s = sessionRef.current;
      if (s && effectiveIsHostRef.current) sendState(s);
    }, JOIN_SNAPSHOT_DEBOUNCE_MS);
    // Not cleared on every members change (someone leaving must not cancel
    // a pending snapshot); the unmount effect below clears it.
  }, [
    visitor,
    effectiveIsHost,
    liveRoomCode,
    room.isLocalOnly,
    room.isConnected,
    room.members,
    sendState,
  ]);

  useEffect(
    () => () => {
      if (joinSnapshotTimerRef.current !== null) clearTimeout(joinSnapshotTimerRef.current);
      joinSnapshotTimerRef.current = null;
    },
    [liveRoomCode]
  );

  // Visitor rooms: every client leaves after the hard TTL, whatever else
  // happens. The host tells everyone first, so the room ends with it.
  useEffect(() => {
    if (!visitor || !liveRoomCode) return;
    const t = setTimeout(() => {
      if (effectiveIsHostRef.current && !roomRef.current.isLocalOnly) {
        roomRef.current.broadcast("poker:session-ended", { by: roomRef.current.userId });
      }
      setIdleWarning(false);
      setLeftReason("expired");
    }, VISITOR_LIMITS.hardTtlMs);
    return () => clearTimeout(t);
  }, [visitor, liveRoomCode]);

  // Visitor rooms: the trusted host's control messages. `poker:kick` for
  // this client makes it leave (and stop re-seating itself); for anyone
  // else it adds them to this client's ignore list. `poker:session-ended`
  // makes every participant leave instead of electing a new host.
  useEffect(() => {
    if (!visitor || !liveRoomCode || room.isLocalOnly) return;
    const fromTrustedHost = (raw: unknown): Record<string, unknown> | null => {
      if (!raw || typeof raw !== "object") return null;
      const env = raw as Record<string, unknown>;
      const r = roomRef.current;
      if (typeof env.by !== "string" || env.by === r.userId) return null;
      if (env.by !== trustedHostIdRef.current) return null;
      if (!r.members.some((m) => m.id === env.by)) return null;
      return env;
    };
    const offKick = roomRef.current.subscribeToEvent("poker:kick", (raw) => {
      const env = fromTrustedHost(raw);
      if (!env || typeof env.id !== "string" || env.id.length > 64) return;
      if (env.id === roomRef.current.userId) {
        setLeftReason("kicked");
        return;
      }
      rememberBlocked(env.id);
    });
    const offEnded = roomRef.current.subscribeToEvent("poker:session-ended", (raw) => {
      if (fromTrustedHost(raw)) setLeftReason("host-ended");
    });
    return () => {
      offKick();
      offEnded();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitor, liveRoomCode, room.isLocalOnly]);

  // Host-side ghost cleanup: when a participant's realtime presence
  // drops (tab close, navigate away, network blip), prune their entry
  // from the session and re-broadcast. The host's own row stays
  // regardless of presence: the host's `track()` may not have completed
  // yet on the very first render, and we never want the host to prune
  // themselves.
  useEffect(() => {
    if (!effectiveIsHost || !liveRoomCode || room.isLocalOnly) return;
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
  }, [effectiveIsHost, liveRoomCode, room.isLocalOnly, room.isConnected, room.members]);

  // Host migration: if the trusted host has been absent from members
  // for >HOST_MIGRATION_DELAY_MS, the earliest-joined remaining peer
  // (by `joinedAt`) promotes itself. The election is deterministic so
  // all peers independently update their trustedHostId to the same
  // candidate; the new host's broadcasts then pass the merge defence.
  useEffect(() => {
    if (!liveRoomCode || room.isLocalOnly) return;
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
  }, [liveRoomCode, room.isLocalOnly, room.isConnected, room.members]);

  const setSession = useCallback(
    (updater: Session | ((prev: Session | null) => Session | null)) => {
      if (visitorRef.current) markActivity();
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
          sendState(next);
        }
        if (next) {
          trustedHostIdRef.current = next.hostId;
        } else {
          trustedHostIdRef.current = null;
        }
        return next;
      });
    },
    [markActivity, sendState]
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

  const kick = useCallback(
    (id: string) => {
      const r = roomRef.current;
      if (!visitorRef.current || !effectiveIsHostRef.current || r.isLocalOnly) return;
      if (id === r.userId) return;
      rememberBlocked(id);
      setSession((prev) => (prev ? removePlayer(prev, id) : prev));
      r.broadcast("poker:kick", { by: r.userId, id });
    },
    [rememberBlocked, setSession]
  );

  const endRoom = useCallback(() => {
    if (!visitorRef.current) return;
    if (effectiveIsHostRef.current) broadcastSessionEnded();
    setIdleWarning(false);
    setLeftReason("ended");
  }, [broadcastSessionEnded]);

  return {
    session,
    setSession,
    isConnected: room.isConnected,
    isLocalOnly: room.isLocalOnly,
    userId: room.userId,
    isHost: effectiveIsHost,
    broadcastSessionEnded,
    subscribeToSessionEnded,
    memberCount: room.members.length,
    roomFull: room.roomFull,
    leftReason,
    kick,
    endRoom,
    idleWarning,
    keepRoomOpen: markActivity,
  };
}
