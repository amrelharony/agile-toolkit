"use client";

/**
 * The core of the signed visitor rooms (show rooms, wall rooms): one hook
 * for both ends, which the room kinds build on (`show-room/use-show-room.ts`,
 * `wall-room/use-wall-room.ts`). It runs what every signed room shares, the
 * way the vote rounds do (`vote-room/use-vote-room.ts`), and leaves what the
 * state holds, and anything participants send, to the kind.
 *
 * Host:
 *  - makes the room's keys first ("preparing"); the channel opens only once
 *    they exist;
 *  - sends a signed state when the kind asks (`scheduleState`, at most every
 *    `stateThrottleMs`), 500 ms after the last of a burst of joins, and every
 *    30 s; a state over `maxStateChars` isn't sent (the host is told once);
 *  - can remove a member (soft: a new tab gets a new id; the same id coming
 *    back is told again) and end the room; the idle prompt after 30 minutes,
 *    then the end; the 3-hour limit. No host migration: the room exists in
 *    the host's tab only.
 *
 * Participant:
 *  - needs the host key's fingerprint from the link's `#k=`; without it the
 *    status is "bad-link" and nothing opens;
 *  - pins the first state whose key matches the fingerprint, whose signature
 *    verifies, and whose sender is present (a verified state that beat its
 *    sender's presence waits for it); afterwards only that sender and key,
 *    with a rising seq. Kick and end count only when signed by the pinned
 *    key;
 *  - "host-left" once the pinned host has been missing 10 s; "no-host" when
 *    no host's state arrived within 90 s of connecting (an old link).
 *
 * Both: "full" when the room already had 20 people; "unavailable" when the
 * channel can't open. A terminal status drops the room code, so `useRoom`
 * closes the channel. Nothing is written anywhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useRoom, type PresenceMember, type UseRoomResult } from "./use-room";
import { HOST_MIGRATION_DELAY_MS, hostMissingLongEnough } from "./host-election";
import { isWithinJsonSize } from "./sanitize";
import {
  VISITOR_LIMITS,
  isVisitorIdentity,
  isVisitorRoomCode,
  isVisitorTool,
  visitorRoomsEnabled,
  type VisitorIdentity,
  type VisitorTool,
} from "./visitor-rooms";
import {
  isVoteFingerprint,
  webVoteCrypto,
  type HostKeyPair,
  type VoteCrypto,
} from "./vote-room/crypto";
import {
  SIGNED_ROOM_VERSION,
  readRoomEnd,
  readRoomKick,
  signedJoinUrl,
  type RoomEndBody,
  type RoomKickBody,
  type Signed,
  type SignedRoomHead,
} from "./signed-room";
import { toast } from "@/lib/utils/toast";
import type { RoomExtrasPort, RoomExtrasSigner } from "./use-room-extras";

/** How often the host checks whether the room has gone idle. */
const IDLE_CHECK_MS = 30_000;
/** The host re-sends this long after the last of a burst of joins. */
const JOIN_DEBOUNCE_MS = 500;
/** Participant: no host's state this long after connecting means nobody is hosting. */
export const SIGNED_NO_HOST_TIMEOUT_MS = 3 * VISITOR_LIMITS.keepaliveMs;

export type SignedRoomStatus =
  /** Host: making the room's keys. No channel yet. */
  | "preparing"
  /** Channel opening. */
  | "connecting"
  /** Participant: connected, waiting for the host's first signed state. */
  | "waiting"
  | "live"
  /** The host ended the room (or, for the host, it ended after going idle). */
  | "ended"
  /** The room reached its 3-hour limit. */
  | "expired"
  /** The host removed this participant. */
  | "kicked"
  /** The room already had 20 people. */
  | "full"
  /** This participant left. */
  | "left"
  /** Participant: the host has been gone 10 s. */
  | "host-left"
  /** Participant: no host's state arrived within 90 s of connecting. */
  | "no-host"
  /** No live room here: flag off, no Supabase, no WebCrypto, a refused token, bad options. */
  | "unavailable"
  /** Participant: the link has no (or a malformed) `#k=` host key. */
  | "bad-link";

export type SignedRoomEndReason = "host" | "idle" | "expired" | "host-left";

const TERMINAL: ReadonlySet<SignedRoomStatus> = new Set<SignedRoomStatus>([
  "ended",
  "expired",
  "kicked",
  "full",
  "left",
  "host-left",
  "no-host",
  "unavailable",
  "bad-link",
]);

/** Whether a status means the room is over (or never opened) on this side. */
export function isSignedRoomClosed(status: SignedRoomStatus): boolean {
  return TERMINAL.has(status);
}

/** The kind-specific part of a state: everything but the head. */
export type StateBodyOf<S extends SignedRoomHead> = Omit<S, keyof SignedRoomHead>;

export interface SignedRoomConfig<S extends SignedRoomHead> {
  tool: VisitorTool;
  code: string;
  identity: VisitorIdentity;
  role: "host" | "participant";
  /** Participant: from the join link's `#k=`. */
  hostFingerprint?: string | null;
  /** Host: when the room started (epoch ms). Defaults to mount time. */
  startedAt?: number;
  /** Tests inject a fake. Defaults to WebCrypto; null means none. */
  crypto?: VoteCrypto | null;
  events: { state: string; kick: string; end: string };
  /** The signed text of a state. */
  stateInput: (body: S) => string;
  /** The signed text of a kick or an end. */
  controlInput: (event: string, body: RoomKickBody | RoomEndBody) => string;
  /** A state for this tool from the wire, shape-checked (not its signature), or null. */
  readState: (raw: unknown) => Signed<S> | null;
  /** Largest state sent or read, in JSON characters. */
  maxStateChars: number;
  /** Shortest gap between two states from the host. */
  stateThrottleMs: number;
  /** Host: the state's own part, or null to send nothing yet. Read when sending. */
  buildBody: () => StateBodyOf<S> | null;
  /** Participant: a verified state from the pinned host, newer than the last. */
  onState: (msg: Signed<S>) => void;
  /** Host: the toast when the state is too big to send. */
  tooBigMessage: string;
}

export interface SignedRoom {
  status: SignedRoomStatus;
  endReason: SignedRoomEndReason | null;
  role: "host" | "participant";
  selfId: string;
  /** Host: itself. Participant: the pinned host, once a signed state arrived. */
  hostId: string | null;
  hostName: string | null;
  /** People in the channel, as `useRoom` seats them (at most 20). */
  members: PresenceMember[];
  /** Ids the host removed (host only). */
  removedIds: ReadonlySet<string>;
  /** `/join/<tool>/<code>#k=<fingerprint>`, once the host key is known. */
  joinPath: string | null;
  /** When the room closes for everyone (epoch ms). */
  endsAt: number | null;
  /** Host: the room has been idle 30 minutes and will end unless kept open. */
  idlePrompt: boolean;
  keepOpen: () => void;
  /** Host: remove a member (soft). */
  kick: (id: string) => void;
  /** Host: end the room for everyone. */
  end: (reason?: "host" | "idle" | "expired") => void;
  /** Leave the room (the host's leave ends it). */
  leave: () => void;
  /** For the room's countdown and reactions (`useRoomExtras`): signed with the room key. */
  extras: RoomExtrasPort;
  // For the room kinds built on top:
  /** The channel, for the kind's own events. */
  room: UseRoomResult<null>;
  /** False once the room is over on this side (set before React re-renders). */
  activeRef: MutableRefObject<boolean>;
  /** The host's keys (host), once made. */
  keysRef: MutableRefObject<HostKeyPair | null>;
  /** Participant: the pinned host's public keys, once a state verified. */
  pinnedRef: MutableRefObject<{ by: string; sigKey: string; ecdh: string } | null>;
  crypto: VoteCrypto | null;
  /** Host: send a state soon (throttled). */
  scheduleState: () => void;
  /** Host: count something happening, for the idle prompt. */
  touch: () => void;
  /** Host: members holding a seat now, the host included. */
  admitted: () => Set<string>;
  /** Host: the ids removed, live. */
  removedRef: MutableRefObject<Set<string>>;
}

export function useSignedRoom<S extends SignedRoomHead>(config: SignedRoomConfig<S>): SignedRoom {
  const { tool, code, identity, role } = config;
  const selfId = identity.id;
  const hostFingerprint = role === "participant" ? (config.hostFingerprint ?? null) : null;
  const cfgRef = useRef(config);
  cfgRef.current = config;

  const [cryptoImpl] = useState<VoteCrypto | null>(() =>
    config.crypto !== undefined ? config.crypto : webVoteCrypto()
  );
  const [status, setStatus] = useState<SignedRoomStatus>(() => {
    if (role === "participant" && !isVoteFingerprint(hostFingerprint)) return "bad-link";
    if (
      !visitorRoomsEnabled() ||
      !isVisitorTool(tool) ||
      !isVisitorRoomCode(code) ||
      !isVisitorIdentity(identity) ||
      !cryptoImpl
    ) {
      return "unavailable";
    }
    return role === "host" ? "preparing" : "connecting";
  });
  const [endReason, setEndReason] = useState<SignedRoomEndReason | null>(null);
  const [hostId, setHostId] = useState<string | null>(role === "host" ? selfId : null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [viewEndsAt, setViewEndsAt] = useState<number | null>(null);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [removedVersion, setRemovedVersion] = useState(0);

  const active = !TERMINAL.has(status);
  const requested = active && status !== "preparing" ? code : null;
  const room = useRoom<null>(tool, requested, null, { visitor: true, identity });

  const roomRef = useRef(room);
  roomRef.current = room;
  const closingRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active && !closingRef.current;
  const keysRef = useRef<HostKeyPair | null>(null);
  const removedRef = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const endsAtRef = useRef<number>(
    (role === "host" ? (config.startedAt ?? mountedAtRef.current) : mountedAtRef.current) +
      VISITOR_LIMITS.hardTtlMs
  );
  const lastSentRef = useRef(0);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());
  const sizeWarnedRef = useRef(false);
  const seenMembersRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pinnedRef = useRef<{ by: string; sigKey: string; ecdh: string } | null>(null);
  const lastSeqRef = useRef(-1);
  const pendingStateRef = useRef<Signed<S> | null>(null);
  const missingSinceRef = useRef<number | null>(null);

  /** Run `task` after every task queued before it: signing and verifying keep their order. */
  const enqueue = useCallback((task: () => Promise<void>): Promise<void> => {
    const next = queueRef.current.then(task).catch(() => {});
    queueRef.current = next;
    return next;
  }, []);

  const touch = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdlePrompt(false);
  }, []);

  const clearTimers = useCallback(() => {
    if (sendTimerRef.current !== null) clearTimeout(sendTimerRef.current);
    if (joinTimerRef.current !== null) clearTimeout(joinTimerRef.current);
    sendTimerRef.current = null;
    joinTimerRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const stop = useCallback(
    (next: SignedRoomStatus, reason: SignedRoomEndReason | null = null) => {
      activeRef.current = false;
      clearTimers();
      setIdlePrompt(false);
      if (reason) setEndReason(reason);
      setStatus(next);
    },
    [clearTimers]
  );

  // ── Host: sending ────────────────────────────────────────────────

  const sendState = useCallback(() => {
    if (role !== "host" || !cryptoImpl) return;
    void enqueue(async () => {
      if (!activeRef.current || !roomRef.current.isConnected) return;
      const k = keysRef.current;
      const own = cfgRef.current.buildBody();
      if (!k || !own) return;
      const body = {
        ...own,
        v: SIGNED_ROOM_VERSION,
        by: selfId,
        seq: seqRef.current + 1,
        tool,
        endsAt: endsAtRef.current,
        keys: k.publicKeys,
      } as unknown as S;
      if (!isWithinJsonSize({ ...body, sig: "x".repeat(86) }, cfgRef.current.maxStateChars)) {
        if (!sizeWarnedRef.current) {
          sizeWarnedRef.current = true;
          toast.error(cfgRef.current.tooBigMessage);
        }
        return;
      }
      sizeWarnedRef.current = false;
      const sig = await cryptoImpl.sign(k, cfgRef.current.stateInput(body));
      if (!activeRef.current) return;
      seqRef.current = body.seq;
      lastSentRef.current = Date.now();
      roomRef.current.broadcast(cfgRef.current.events.state, { ...body, sig });
    });
  }, [cryptoImpl, enqueue, role, selfId, tool]);

  const scheduleState = useCallback(() => {
    if (role !== "host" || sendTimerRef.current !== null) return;
    const wait = Math.max(0, cfgRef.current.stateThrottleMs - (Date.now() - lastSentRef.current));
    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      sendState();
    }, wait);
  }, [role, sendState]);

  const sendSigned = useCallback(
    (event: string, body: RoomKickBody | RoomEndBody) =>
      enqueue(async () => {
        const k = keysRef.current;
        if (!k || !cryptoImpl || !roomRef.current.isConnected) return;
        const sig = await cryptoImpl.sign(k, cfgRef.current.controlInput(event, body));
        roomRef.current.broadcast(event, { ...body, sig });
      }),
    [cryptoImpl, enqueue]
  );

  // ── Host: keys ───────────────────────────────────────────────────

  useEffect(() => {
    if (role !== "host" || status !== "preparing" || !cryptoImpl) return;
    let cancelled = false;
    cryptoImpl
      .createHostKeys()
      .then((k) => {
        if (cancelled) return;
        keysRef.current = k;
        setFingerprint(k.fingerprint);
        setStatus((s) => (s === "preparing" ? "connecting" : s));
      })
      .catch(() => {
        if (!cancelled) stop("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [role, status, cryptoImpl, stop]);

  // ── Host: ending ─────────────────────────────────────────────────

  const end = useCallback(
    (reason: "host" | "idle" | "expired" = "host") => {
      if (role !== "host" || !activeRef.current) return;
      closingRef.current = true;
      activeRef.current = false;
      clearTimers();
      setIdlePrompt(false);
      const finish = () => {
        setEndReason(reason);
        setStatus(reason === "expired" ? "expired" : "ended");
      };
      void sendSigned(cfgRef.current.events.end, {
        v: SIGNED_ROOM_VERSION,
        by: selfId,
        reason,
      }).then(finish);
    },
    [clearTimers, role, selfId, sendSigned]
  );

  // ── Participant: inbound ─────────────────────────────────────────

  const present = useCallback((id: string) => roomRef.current.members.some((m) => m.id === id), []);

  const acceptState = useCallback(
    (msg: Signed<S>) =>
      enqueue(async () => {
        if (!activeRef.current || !cryptoImpl) return;
        const pinned = pinnedRef.current;
        if (pinned) {
          if (msg.by !== pinned.by || msg.keys.sig !== pinned.sigKey) return;
          if (msg.seq <= lastSeqRef.current) return;
        } else {
          let fp: string;
          try {
            fp = await cryptoImpl.fingerprint(msg.keys.sig);
          } catch {
            return;
          }
          if (fp !== hostFingerprint) return;
        }
        const { sig, ...body } = msg;
        const ok = await cryptoImpl.verify(
          msg.keys.sig,
          cfgRef.current.stateInput(body as unknown as S),
          sig
        );
        if (!ok || !activeRef.current) return;
        const now = pinnedRef.current;
        if (now && (now.by !== msg.by || now.sigKey !== msg.keys.sig)) return;
        if (msg.seq <= lastSeqRef.current) return;
        if (!now && !present(msg.by)) {
          // The host's first state beat its presence entry: held (the newest)
          // until the sender shows up. The signature covers `by`.
          const held = pendingStateRef.current;
          if (!held || held.seq < msg.seq) pendingStateRef.current = msg;
          return;
        }
        pinnedRef.current = { by: msg.by, sigKey: msg.keys.sig, ecdh: msg.keys.ecdh };
        lastSeqRef.current = msg.seq;
        pendingStateRef.current = null;
        missingSinceRef.current = null;
        setHostId(msg.by);
        setViewEndsAt(msg.endsAt);
        cfgRef.current.onState(msg);
        setStatus((s) => (s === "connecting" || s === "waiting" ? "live" : s));
      }),
    [cryptoImpl, enqueue, hostFingerprint, present]
  );

  const fromPinnedHost = useCallback(
    async (event: string, body: RoomKickBody | RoomEndBody, sig: string) => {
      const pinned = pinnedRef.current;
      if (!pinned || body.by !== pinned.by || !cryptoImpl) return false;
      return cryptoImpl.verify(pinned.sigKey, cfgRef.current.controlInput(event, body), sig);
    },
    [cryptoImpl]
  );

  useEffect(() => {
    const r = roomRef.current;
    const { events, maxStateChars } = cfgRef.current;
    const offState = r.subscribeToEvent(events.state, (raw) => {
      // The host's own state is the only truth: inbound state is never applied.
      if (role !== "participant" || !activeRef.current) return;
      if (!isWithinJsonSize(raw, maxStateChars)) return;
      const msg = cfgRef.current.readState(raw);
      if (!msg || msg.by === selfId) return;
      const pinned = pinnedRef.current;
      if (pinned) {
        if (msg.by !== pinned.by || msg.keys.sig !== pinned.sigKey) return;
        if (msg.seq <= lastSeqRef.current) return;
      }
      void acceptState(msg);
    });
    const offKick = r.subscribeToEvent(events.kick, (raw) => {
      if (role !== "participant" || !activeRef.current) return;
      const msg = readRoomKick(raw, maxStateChars);
      if (!msg || msg.id !== selfId) return;
      const { sig, ...body } = msg;
      void enqueue(async () => {
        if (!activeRef.current) return;
        if (await fromPinnedHost(events.kick, body, sig)) stop("kicked");
      });
    });
    const offEnd = r.subscribeToEvent(events.end, (raw) => {
      if (role !== "participant" || !activeRef.current) return;
      const msg = readRoomEnd(raw, maxStateChars);
      if (!msg) return;
      const { sig, ...body } = msg;
      void enqueue(async () => {
        if (!activeRef.current) return;
        if (!(await fromPinnedHost(events.end, body, sig))) return;
        if (body.reason === "expired") stop("expired", "expired");
        else stop("ended", body.reason);
      });
    });
    return () => {
      offState();
      offKick();
      offEnd();
    };
  }, [acceptState, enqueue, fromPinnedHost, role, selfId, stop]);

  // A verified first state that beat its sender's presence entry.
  useEffect(() => {
    const pending = pendingStateRef.current;
    if (role !== "participant" || !pending || pinnedRef.current) return;
    if (room.members.some((m) => m.id === pending.by)) {
      pendingStateRef.current = null;
      void acceptState(pending);
    }
  }, [room.members, role, acceptState]);

  // ── Status from the channel ──────────────────────────────────────

  useEffect(() => {
    if (room.roomFull && active) stop("full");
  }, [room.roomFull, active, stop]);

  useEffect(() => {
    if (active && requested !== null && room.isLocalOnly) stop("unavailable");
  }, [active, requested, room.isLocalOnly, stop]);

  useEffect(() => {
    if (!room.isConnected) return;
    if (role === "host") setStatus((s) => (s === "connecting" ? "live" : s));
    else setStatus((s) => (s === "connecting" ? "waiting" : s));
  }, [role, room.isConnected]);

  // ── Participant: nobody is hosting ───────────────────────────────

  useEffect(() => {
    if (role !== "participant" || status !== "waiting") return;
    const t = setTimeout(() => {
      if (!pinnedRef.current) stop("no-host");
    }, SIGNED_NO_HOST_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [role, status, stop]);

  // ── Host: send on join, as a keepalive ───────────────────────────

  useEffect(() => {
    if (role !== "host" || !active || !room.isConnected) return;
    const ids = new Set(room.members.map((m) => m.id));
    const joinedIds: string[] = [];
    ids.forEach((id) => {
      if (!seenMembersRef.current.has(id)) joinedIds.push(id);
    });
    const left = Array.from(seenMembersRef.current).some((id) => !ids.has(id));
    seenMembersRef.current = ids;
    // Someone the host removed came back under the same id: tell them again.
    for (const id of joinedIds) {
      if (removedRef.current.has(id)) {
        void sendSigned(cfgRef.current.events.kick, { v: SIGNED_ROOM_VERSION, by: selfId, id });
      }
    }
    if (joinedIds.length > 0 || left) touch();
    if (joinedIds.length > 0) {
      if (joinTimerRef.current !== null) clearTimeout(joinTimerRef.current);
      joinTimerRef.current = setTimeout(() => {
        joinTimerRef.current = null;
        sendState();
      }, JOIN_DEBOUNCE_MS);
    }
    // Someone left: what the state counts of them (hands, "I'm here") may change.
    if (left) scheduleState();
  }, [
    room.members,
    room.isConnected,
    role,
    active,
    touch,
    sendState,
    sendSigned,
    scheduleState,
    selfId,
  ]);

  useEffect(() => {
    if (role !== "host" || !active || !room.isConnected || fingerprint === null) return;
    scheduleState();
    const id = setInterval(sendState, VISITOR_LIMITS.keepaliveMs);
    return () => clearInterval(id);
  }, [role, active, room.isConnected, fingerprint, scheduleState, sendState]);

  // ── Host: idle prompt, then end ──────────────────────────────────

  useEffect(() => {
    if (role !== "host" || !active) return;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= VISITOR_LIMITS.idleMs) setIdlePrompt(true);
    }, IDLE_CHECK_MS);
    return () => clearInterval(id);
  }, [role, active]);

  useEffect(() => {
    if (!idlePrompt || role !== "host" || !active) return;
    const t = setTimeout(() => end("idle"), VISITOR_LIMITS.idleGraceMs);
    return () => clearTimeout(t);
  }, [idlePrompt, role, active, end]);

  // ── Everyone: the hard TTL ───────────────────────────────────────

  useEffect(() => {
    if (!active) return;
    const ownLimit = mountedAtRef.current + VISITOR_LIMITS.hardTtlMs;
    const deadline =
      role === "host" ? endsAtRef.current : Math.min(ownLimit, viewEndsAt ?? Infinity);
    const t = setTimeout(
      () => {
        if (role === "host") end("expired");
        else stop("expired", "expired");
      },
      Math.max(0, deadline - Date.now())
    );
    return () => clearTimeout(t);
  }, [active, role, viewEndsAt, end, stop]);

  // ── Participant: the host left ───────────────────────────────────

  useEffect(() => {
    if (role !== "participant" || !active || !room.isConnected) return;
    const pinned = pinnedRef.current;
    if (!pinned) return;
    if (room.members.some((m) => m.id === pinned.by)) {
      missingSinceRef.current = null;
      return;
    }
    if (missingSinceRef.current === null) missingSinceRef.current = Date.now();
    const wait = Math.max(0, HOST_MIGRATION_DELAY_MS - (Date.now() - missingSinceRef.current));
    const t = setTimeout(() => {
      if (roomRef.current.members.some((m) => m.id === pinned.by)) return;
      if (!hostMissingLongEnough(missingSinceRef.current, Date.now())) return;
      stop("host-left", "host-left");
    }, wait);
    return () => clearTimeout(t);
  }, [room.members, room.isConnected, role, active, stop]);

  // ── Actions ──────────────────────────────────────────────────────

  const kick = useCallback(
    (id: string) => {
      if (role !== "host" || !activeRef.current || id === selfId) return;
      removedRef.current.add(id);
      setRemovedVersion((n) => n + 1);
      touch();
      void sendSigned(cfgRef.current.events.kick, { v: SIGNED_ROOM_VERSION, by: selfId, id });
      scheduleState();
    },
    [role, scheduleState, selfId, sendSigned, touch]
  );

  const leave = useCallback(() => {
    if (!activeRef.current) return;
    if (role === "host") end("host");
    else stop("left");
  }, [end, role, stop]);

  const admitted = useCallback(() => {
    const ids = new Set(roomRef.current.members.map((m) => m.id));
    ids.add(selfId);
    return ids;
  }, [selfId]);

  const removedIds = useMemo(
    () => new Set(removedRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removedVersion]
  );

  const hostName =
    hostId === null
      ? null
      : hostId === selfId
        ? identity.name
        : (room.members.find((m) => m.id === hostId)?.name ?? null);

  const joinPath =
    role === "host"
      ? fingerprint
        ? signedJoinUrl(tool, code, fingerprint)
        : null
      : isVoteFingerprint(hostFingerprint)
        ? signedJoinUrl(tool, code, hostFingerprint)
        : null;

  // The countdown and reactions sign with the room key and trust only the pinned host.
  const extrasSigner = useMemo<RoomExtrasSigner | null>(
    () =>
      cryptoImpl
        ? {
            sign: async (input) => {
              const k = keysRef.current;
              return k ? cryptoImpl.sign(k, input) : null;
            },
            verify: async (by, input, sig) => {
              const pinned = pinnedRef.current;
              if (!pinned || pinned.by !== by) return false;
              return cryptoImpl.verify(pinned.sigKey, input, sig);
            },
          }
        : null,
    [cryptoImpl]
  );

  return {
    status,
    endReason,
    role,
    selfId,
    hostId,
    hostName,
    members: room.members,
    removedIds,
    joinPath,
    endsAt: role === "host" ? endsAtRef.current : viewEndsAt,
    idlePrompt,
    keepOpen: touch,
    kick,
    end,
    leave,
    extras: {
      tool,
      code,
      role,
      selfId,
      hostId,
      live: active && status !== "preparing",
      channel: room,
      signer: extrasSigner,
      // The host's list; that's the screen the room sees, big screen included.
      blocked: (id) => removedRef.current.has(id),
    },
    room,
    activeRef,
    keysRef,
    pinnedRef,
    crypto: cryptoImpl,
    scheduleState,
    touch,
    admitted,
    removedRef,
  };
}
