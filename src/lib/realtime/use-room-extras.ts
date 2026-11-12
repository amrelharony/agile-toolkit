"use client";

/**
 * What every visitor room adds on top of its own state: the host's countdown
 * on everyone's phone (`room-timer.ts`) and emoji reactions
 * (`room-reactions.ts`). One hook for both ends, fed by a small port each
 * room hook exposes as `extras` (Poker's `usePokerSession`, Retro's
 * `useRetroRoom`, the vote rounds' `useVoteRoom`, and the show and wall
 * rooms through `useSignedRoom`):
 *
 *   const extras = useRoomExtras(room.extras);
 *   extras.timer;                 // on this device's clock
 *   extras.setTimer(startRoomTimer(300, Date.now()));   // host
 *   extras.react(0);              // anyone: 👍
 *
 * Timer, host: sends the timer when it changes, about a second after
 * someone joins, and every 30 s while one has been set (a stopped timer
 * keeps saying so). Never once a second: every screen counts down from the
 * end time by itself. In a signed room each timer is signed with the room
 * key; Poker sends it unsigned, as it sends its session.
 *
 * Timer, participant: takes timers only from the host the room trusts
 * (`port.hostId`: the pinned host in a signed room, the session's host in
 * Poker), newer than the last, and in a signed room only with a signature
 * that checks against the pinned key. A timer that beat the host's first
 * state waits for it. The end time moves onto this device's clock. When
 * the trusted host changes, the old host's timer goes. When this side's
 * own role changes (Poker's host migration), what it showed goes too: a
 * promoted host starts without a timer instead of counting down, and
 * auto-revealing at, one nobody else sees.
 *
 * Reactions: anyone in the room sends an index (never text). This device
 * shows its own at once (a broadcast doesn't come back to its sender) and
 * everyone else's from members present in the room and not removed by the
 * host (`port.blocked`), each sender held to a short burst and then about
 * one every 2 s, and the whole room to a few a second. The sender id is
 * self-declared, so only the room-wide limit bounds a script that claims
 * other members' ids. Nothing is kept: each leaves the screen after 2.4 s.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ROOM_TIMER_EVENT,
  ROOM_TIMER_VERSION,
  anchorRoomTimer,
  readRoomTimerMessage,
  roomTimerInput,
  sameRoomTimer,
  type RoomTimer,
  type RoomTimerMessage,
} from "./room-timer";
import {
  REACTION_LIMITS,
  ROOM_REACT_EVENT,
  ROOM_REACT_VERSION,
  addFloating,
  createReactionLimiter,
  isReactionIndex,
  reactionLane,
  readReactionMessage,
  type FloatingReaction,
} from "./room-reactions";

/** The slice of a room's channel the extras use (`useRoom`'s result has it all). */
export interface RoomExtrasChannel {
  broadcast: (event: string, payload: unknown) => void;
  subscribeToEvent: (event: string, handler: (payload: unknown) => void) => () => void;
  isConnected: boolean;
  members: readonly { id: string }[];
}

/** Signed rooms: the host signs with the room key; participants check against the pinned key. */
export interface RoomExtrasSigner {
  /** Host: the room key's signature over `input`, or null before the key exists. */
  sign: (input: string) => Promise<string | null>;
  /** Participant: whether `by` is the pinned host and `sig` is its key's signature over `input`. */
  verify: (by: string, input: string, sig: string) => Promise<boolean>;
}

/** What a room hook hands the extras. Rebuilt every render is fine: the hook reads it through a ref. */
export interface RoomExtrasPort {
  tool: string;
  code: string;
  role: "host" | "participant";
  selfId: string;
  /** The host this side trusts: itself (host), else the pinned or trusted host; null until known. */
  hostId: string | null;
  /** False before the room opens on this side and once it is over. */
  live: boolean;
  channel: RoomExtrasChannel;
  /** Signed rooms (vote, show, wall). Null for Poker and Retro. */
  signer: RoomExtrasSigner | null;
  /**
   * Members the host removed who may still be connected: their reactions
   * are dropped. The host always knows; Poker's participants learn it from
   * the host's kick messages.
   */
  blocked?: (id: string) => boolean;
}

export interface RoomExtras {
  /** The countdown, on this device's clock; null when there is none. */
  timer: RoomTimer | null;
  /** Host: put a timer up, change it, or take it down (null). */
  setTimer: (next: RoomTimer | null) => void;
  /** This side may set the timer (the host, while the room is open). */
  canSetTimer: boolean;
  /** Reactions on screen now, oldest first. */
  reactions: readonly FloatingReaction[];
  /** Send reaction `r` (an index into `ROOM_REACTIONS`). False when refused (too fast, room closed). */
  react: (r: number) => boolean;
  /** The room is open on this side, so reactions can be sent. */
  live: boolean;
  role: "host" | "participant";
}

export interface UseRoomExtrasOptions {
  /** Sync a room timer. Off for Retro, whose snapshot carries its own. Default on. */
  timer?: boolean;
  /** Reactions. Default on. */
  reactions?: boolean;
  /** Tests: the clock. */
  now?: () => number;
}

/** The host re-sends its timer this often while one has been set. */
export const ROOM_TIMER_RESEND_MS = 30_000;
/** The host re-sends this long after the last of a burst of joins (after the room's own state). */
export const ROOM_TIMER_JOIN_DELAY_MS = 1_200;

const NO_PORT_ROLE = "participant" as const;

export function useRoomExtras(
  port: RoomExtrasPort | null,
  opts: UseRoomExtrasOptions = {}
): RoomExtras {
  const timerOn = opts.timer !== false;
  const reactOn = opts.reactions !== false;
  const portRef = useRef(port);
  portRef.current = port;
  const nowRef = useRef(opts.now ?? Date.now);
  nowRef.current = opts.now ?? Date.now;

  const role = port?.role ?? NO_PORT_ROLE;
  const live = port?.live === true;
  const connected = live && port?.channel.isConnected === true;
  const hostId = port?.hostId ?? null;
  const subscribe = port?.channel.subscribeToEvent ?? null;

  const [timer, setTimerState] = useState<RoomTimer | null>(null);
  const timerRef = useRef<RoomTimer | null>(null);
  const showTimer = useCallback((next: RoomTimer | null) => {
    if (sameRoomTimer(timerRef.current, next)) return;
    timerRef.current = next;
    setTimerState(next);
  }, []);

  // ── Timer: host ──────────────────────────────────────────────────

  const seqRef = useRef(0);
  const everSetRef = useRef(false);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());

  const sendTimer = useCallback(() => {
    sendQueueRef.current = sendQueueRef.current
      .then(async () => {
        const p = portRef.current;
        if (!p || p.role !== "host" || !p.live || !p.channel.isConnected) return;
        const body: RoomTimerMessage = {
          v: ROOM_TIMER_VERSION,
          by: p.selfId,
          seq: seqRef.current + 1,
          at: nowRef.current(),
          timer: timerRef.current,
        };
        if (p.signer) {
          const sig = await p.signer.sign(roomTimerInput(p.tool, p.code, body));
          if (!sig) return;
          body.sig = sig;
        }
        const after = portRef.current;
        if (!after || after.role !== "host" || !after.live) return;
        seqRef.current = body.seq;
        after.channel.broadcast(ROOM_TIMER_EVENT, body);
      })
      .catch(() => {});
  }, []);

  const setTimer = useCallback(
    (next: RoomTimer | null) => {
      const p = portRef.current;
      if (!timerOn || !p || p.role !== "host" || !p.live) return;
      everSetRef.current = true;
      timerRef.current = next;
      setTimerState(next);
      sendTimer();
    },
    [sendTimer, timerOn]
  );

  // Connected (again): send what's set, so nobody waits for the keepalive.
  useEffect(() => {
    if (!timerOn || role !== "host" || !connected || !everSetRef.current) return;
    sendTimer();
  }, [timerOn, role, connected, sendTimer]);

  // Someone joined: send it again shortly, after the room's own state. One
  // send after the last of a burst of joins; someone leaving meanwhile
  // doesn't cancel it (only a fresh join re-arms it).
  const seenRef = useRef<Set<string>>(new Set());
  const joinSendRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberKey = port ? port.channel.members.map((m) => m.id).join(",") : "";
  useEffect(() => {
    if (!timerOn || role !== "host" || !connected) return;
    const self = portRef.current?.selfId;
    const ids = memberKey ? memberKey.split(",") : [];
    const fresh = ids.some((id) => id !== self && !seenRef.current.has(id));
    seenRef.current = new Set(ids);
    if (!fresh || !everSetRef.current) return;
    if (joinSendRef.current !== null) clearTimeout(joinSendRef.current);
    joinSendRef.current = setTimeout(() => {
      joinSendRef.current = null;
      sendTimer();
    }, ROOM_TIMER_JOIN_DELAY_MS);
  }, [timerOn, role, connected, memberKey, sendTimer]);
  useEffect(
    () => () => {
      if (joinSendRef.current !== null) clearTimeout(joinSendRef.current);
    },
    []
  );

  // Keepalive.
  useEffect(() => {
    if (!timerOn || role !== "host" || !connected) return;
    const id = setInterval(() => {
      if (everSetRef.current) sendTimer();
    }, ROOM_TIMER_RESEND_MS);
    return () => clearInterval(id);
  }, [timerOn, role, connected, sendTimer]);

  // ── Timer: participant ───────────────────────────────────────────

  const lastSeqRef = useRef(-1);
  const trustedRef = useRef<string | null>(null);
  const pendingRef = useRef<{ msg: RoomTimerMessage; receivedAt: number } | null>(null);

  const accept = useCallback(
    async (msg: RoomTimerMessage, receivedAt: number) => {
      const p = portRef.current;
      if (!p || p.role !== "participant" || !p.live) return;
      if (!p.hostId || msg.by !== p.hostId) {
        // Maybe the host's first state hasn't been checked yet: hold the latest.
        if (!p.hostId) pendingRef.current = { msg, receivedAt };
        return;
      }
      if (msg.seq <= lastSeqRef.current) return;
      if (p.signer) {
        if (!msg.sig) return;
        const ok = await p.signer.verify(msg.by, roomTimerInput(p.tool, p.code, msg), msg.sig);
        const now = portRef.current;
        if (!ok || !now || now.hostId !== msg.by || !now.live) return;
        if (msg.seq <= lastSeqRef.current) return; // a newer one landed meanwhile
      }
      lastSeqRef.current = msg.seq;
      showTimer(msg.timer ? anchorRoomTimer(msg.timer, msg.at, receivedAt) : null);
    },
    [showTimer]
  );

  useEffect(() => {
    if (!timerOn || role !== "participant" || !live || !subscribe) return;
    return subscribe(ROOM_TIMER_EVENT, (raw) => {
      const msg = readRoomTimerMessage(raw);
      if (msg) void accept(msg, nowRef.current());
    });
  }, [timerOn, role, live, subscribe, accept]);

  // This side's role changed (a participant promoted to host, or a host
  // back to participant): what it showed belonged to the old host. Start
  // clean; a participant then takes the trusted host's next timer.
  const roleRef = useRef(role);
  useEffect(() => {
    const before = roleRef.current;
    roleRef.current = role;
    if (before === role) return;
    everSetRef.current = false;
    lastSeqRef.current = -1;
    trustedRef.current = null;
    pendingRef.current = null;
    showTimer(null);
  }, [role, showTimer]);

  // The trusted host is known (or changed): a held timer may now count, an old host's goes.
  useEffect(() => {
    if (!timerOn || role !== "participant") return;
    const before = trustedRef.current;
    trustedRef.current = hostId;
    if (before !== null && before !== hostId) {
      lastSeqRef.current = -1;
      showTimer(null);
    }
    const held = pendingRef.current;
    if (held && hostId && held.msg.by === hostId) {
      pendingRef.current = null;
      void accept(held.msg, held.receivedAt);
    }
  }, [timerOn, role, hostId, accept, showTimer]);

  // The room is over on this side: no countdown.
  useEffect(() => {
    if (live) return;
    pendingRef.current = null;
    if (role === "participant") showTimer(null);
  }, [live, role, showTimer]);

  // ── Reactions ────────────────────────────────────────────────────

  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const inLimiterRef = useRef(
    createReactionLimiter({
      burst: REACTION_LIMITS.receiveBurst,
      refillMs: REACTION_LIMITS.receiveRefillMs,
    })
  );
  const roomLimiterRef = useRef(
    createReactionLimiter({
      burst: REACTION_LIMITS.roomBurst,
      refillMs: REACTION_LIMITS.roomRefillMs,
      maxSenders: 1,
    })
  );
  const outLimiterRef = useRef(createReactionLimiter());
  const shownRef = useRef(0);
  const clearTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = clearTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const showReaction = useCallback((r: number) => {
    const n = shownRef.current++;
    const item: FloatingReaction = { key: `r${n}`, r, lane: reactionLane(n), at: nowRef.current() };
    setReactions((prev) => addFloating(prev, item));
    const t = setTimeout(() => {
      clearTimersRef.current.delete(t);
      setReactions((prev) => prev.filter((x) => x.key !== item.key));
    }, REACTION_LIMITS.showMs);
    clearTimersRef.current.add(t);
  }, []);

  const react = useCallback(
    (r: number): boolean => {
      const p = portRef.current;
      if (!reactOn || !p || !p.live || !p.channel.isConnected || !isReactionIndex(r)) return false;
      if (!outLimiterRef.current.allow(p.selfId, nowRef.current())) return false;
      showReaction(r);
      p.channel.broadcast(ROOM_REACT_EVENT, { v: ROOM_REACT_VERSION, by: p.selfId, r });
      return true;
    },
    [reactOn, showReaction]
  );

  useEffect(() => {
    if (!reactOn || !live || !subscribe) return;
    return subscribe(ROOM_REACT_EVENT, (raw) => {
      const p = portRef.current;
      if (!p || !p.live) return;
      const msg = readReactionMessage(raw);
      if (!msg || msg.by === p.selfId) return;
      if (!p.channel.members.some((m) => m.id === msg.by)) return;
      if (p.blocked?.(msg.by)) return;
      const now = nowRef.current();
      if (!inLimiterRef.current.allow(msg.by, now)) return;
      if (!roomLimiterRef.current.allow("room", now)) return;
      showReaction(msg.r);
    });
  }, [reactOn, live, subscribe, showReaction]);

  useEffect(() => {
    if (live) return;
    setReactions((prev) => (prev.length === 0 ? prev : []));
  }, [live]);

  return {
    timer,
    setTimer,
    canSetTimer: timerOn && role === "host" && live,
    reactions,
    react,
    live: connected,
    role,
  };
}
