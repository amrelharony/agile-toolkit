"use client";

/**
 * Retro visitor room: one hook for both ends of the channel.
 *
 * Host (the visitor who pressed "Everyone on their own device"):
 *  - owns the board. Intents from admitted members go through `applyIntent`
 *    against its latest board, then into the board through `onHostUpdate`
 *    (the Board's own updater);
 *  - never applies an inbound snapshot;
 *  - sends a snapshot at most every 500 ms when the board changes (a timer
 *    tick is not a change), when someone joins, and every 30 s as a
 *    keepalive;
 *  - ends the room at its 3-hour limit, and after 30 minutes with no
 *    activity asks first, then ends it a minute later;
 *  - can remove a member: a blocklist (their intents are dropped) plus a
 *    `retro:kick` asking their client to leave. Soft: a new tab gets a new id.
 *
 * Participant:
 *  - trusts the first host it hears from that is in presence, then only that
 *    id while it stays present (or, once it has been gone 10 s, the member
 *    every peer elects). Snapshots, kicks and "end" from anyone else, or
 *    from the host while it is missing from presence, are dropped;
 *  - keeps the board in memory only. Nothing reaches the workspace store
 *    unless the person presses "Save a copy", and nothing is logged to
 *    history on either side;
 *  - leaves at the room's 3-hour limit (its own join time + 3 h, or the
 *    host's `endsAt` if sooner): `useRoom` doesn't enforce `hardTtlMs`;
 *  - when elected, continues hosting from the last snapshot, still in memory,
 *    and can fix a card's text there (`editCard`): the next snapshot carries
 *    it, so the protocol is unchanged.
 *
 * Nothing opens before the caller mounts this hook, which happens only after
 * the consent dialog. A terminal status (ended, expired, kicked, full, left,
 * unavailable) drops the room code, so `useRoom` closes the channel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useRoom, type PresenceMember } from "@/lib/realtime/use-room";
import {
  electNewHost,
  hostMissingLongEnough,
  HOST_MIGRATION_DELAY_MS,
} from "@/lib/realtime/host-election";
import { cleanText, isWithinJsonSize } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS, type VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import { toast } from "@/lib/utils/toast";
import { MAX_VOTES, type BoardPhase, type BoardState } from "../types";
import { makeId } from "../helpers";
import {
  applyIntent,
  applyPatch,
  createIntentLedger,
  type IntentLedger,
  type IntentPatch,
  type IntentRejection,
} from "./intents";
import {
  BOARD_CARD_CAP,
  IDLE_GRACE_MS,
  MEMBER_CARD_CAP,
  RETRO_ROOM_EVENTS,
  SNAPSHOT_THROTTLE_MS,
  readEndMessage,
  readIntentEnv,
  readKickMessage,
  type IntentEnv,
  type RetroIntent,
  type RoomMember,
  type RoomSnapshot,
} from "./protocol";
import { boardFromSnapshot, readRoomSnapshot, roomSignature, toRoomSnapshot } from "./snapshot";

/** How often the host checks whether the room has gone idle. */
const IDLE_CHECK_MS = 30_000;

export type RetroRoomRole = "host" | "participant";

export type RetroRoomStatus =
  /** Channel opening, or (participant) waiting for the host's first snapshot. */
  | "connecting"
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
  /** Realtime isn't available here (no Supabase config, or the gate refused). */
  | "unavailable";

export type EndReason = "host" | "idle" | "expired";

/** A countdown anchored on this device's clock. */
export interface RoomTimerView {
  running: boolean;
  /** Seconds left at `anchoredAt`. */
  remaining: number;
  /** Local epoch ms. */
  anchoredAt: number;
}

/** Seconds left on `timer` at `now`. */
export function timerRemaining(timer: RoomTimerView, now: number = Date.now()): number {
  if (!timer.running) return timer.remaining;
  return Math.max(0, timer.remaining - Math.floor((now - timer.anchoredAt) / 1000));
}

/** The participant's (or promoted host's) in-memory room. */
interface RoomView {
  board: BoardState;
  timer: RoomTimerView;
  members: RoomMember[];
  votesUsed: Record<string, number>;
  hostId: string;
  endsAt: number;
  seq: number;
}

export type AddCardResult =
  | "added"
  | "sent"
  | "bad-text"
  | "member-cap"
  | "board-full"
  | "wrong-phase"
  | "not-admitted"
  | "closed";

export interface UseRetroRoomOptions {
  code: string;
  identity: VisitorIdentity;
  role: RetroRoomRole;
  /** Host only: the host's live board. */
  hostBoard?: BoardState | null;
  /** Host only: apply a change to the host's board (the Board's `onUpdate`). */
  onHostUpdate?: (updater: (prev: BoardState) => BoardState) => void;
  /** Host only: when the room started (epoch ms). Defaults to mount time. */
  startedAt?: number;
}

export interface RetroRoom {
  status: RetroRoomStatus;
  endReason: EndReason | null;
  /** This client is the host now (started the room, or was elected). */
  isHost: boolean;
  /** This participant took over hosting after the host left. */
  promoted: boolean;
  selfId: string;
  /** Who this client takes as host (itself when hosting). */
  hostId: string | null;
  hostName: string | null;
  /** Host: `hostBoard`. Participant: the last snapshot, in memory. Null before the first one. */
  board: BoardState | null;
  /** Participant and promoted host: the countdown. Null for the host (its board has the timer). */
  timer: RoomTimerView | null;
  /** People in the channel, as `useRoom` seats them (at most 20). */
  members: PresenceMember[];
  /** Ids the host removed (host only). */
  removedIds: ReadonlySet<string>;
  /** Participant: the host's snapshot lists this client, so its intents count. */
  admitted: boolean;
  /** Votes this client has left in the Vote phase. */
  votesLeft: number;
  /** When the room closes for everyone (epoch ms), once known. */
  endsAt: number | null;
  /** Host: the room has been idle 30 minutes and will end unless kept open. */
  idlePrompt: boolean;
  addCard: (columnKey: string, text: string) => AddCardResult;
  vote: (cardId: string) => boolean;
  /** Host: remove a member (soft). */
  kick: (id: string) => void;
  /** Host: end the room for everyone. */
  end: (reason?: EndReason) => void;
  /** Host: answer the idle prompt. */
  keepOpen: () => void;
  /** Participant: leave the room. */
  leave: () => void;
  /** Promoted host: move the in-memory board to `phase`. */
  setPhase: (phase: BoardPhase) => void;
  /** Promoted host: start or pause the countdown. */
  toggleTimer: () => void;
  /** Promoted host: set the countdown (paused). */
  setTimerSeconds: (seconds: number) => void;
  /**
   * Promoted host: change a card's text on the in-memory board. False when
   * this client doesn't host it, the card has gone, or the text is empty or
   * has hidden characters. The starting host edits through its own Board.
   */
  editCard: (cardId: string, text: string) => boolean;
}

const TERMINAL: ReadonlySet<RetroRoomStatus> = new Set<RetroRoomStatus>([
  "ended",
  "expired",
  "kicked",
  "full",
  "left",
  "unavailable",
]);

function rejectionToResult(reason: IntentRejection): AddCardResult {
  switch (reason) {
    case "bad-text":
      return "bad-text";
    case "member-card-cap":
      return "member-cap";
    case "board-card-cap":
      return "board-full";
    case "wrong-phase":
    case "unknown-column":
      return "wrong-phase";
    case "removed":
    case "not-admitted":
      return "not-admitted";
    default:
      return "closed";
  }
}

export function useRetroRoom(opts: UseRetroRoomOptions): RetroRoom {
  const { code, identity, role } = opts;
  const selfId = identity.id;

  const [status, setStatus] = useState<RetroRoomStatus>("connecting");
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [promoted, setPromoted] = useState(false);
  const [view, setView] = useState<RoomView | null>(null);
  const [pendingVotes, setPendingVotes] = useState(0);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [removedVersion, setRemovedVersion] = useState(0);
  const [hostId, setHostId] = useState<string | null>(role === "host" ? selfId : null);

  const active = !TERMINAL.has(status);
  const isHost = role === "host" || promoted;

  const room = useRoom<null>("retro", active ? code : null, null, {
    visitor: true,
    identity,
  });

  // ── Refs read by handlers and timers ─────────────────────────────
  const roomRef = useRef(room);
  roomRef.current = room;
  const activeRef = useRef(active);
  activeRef.current = active;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const viewRef = useRef<RoomView | null>(view);
  const hostBoardRef = useRef<BoardState | null>(opts.hostBoard ?? null);
  hostBoardRef.current = opts.hostBoard ?? null;
  const onHostUpdateRef = useRef(opts.onHostUpdate);
  onHostUpdateRef.current = opts.onHostUpdate;

  const trustedRef = useRef<string | null>(role === "host" ? selfId : null);
  const pendingSnapRef = useRef<RoomSnapshot | null>(null);
  const missingSinceRef = useRef<number | null>(null);
  const ledgerRef = useRef<IntentLedger>(createIntentLedger());
  const blockedRef = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const endsAtRef = useRef<number>(
    (opts.startedAt ?? mountedAtRef.current) + VISITOR_LIMITS.hardTtlMs
  );
  const lastSentRef = useRef(0);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());
  const sizeWarnedRef = useRef(false);
  const sentCardsRef = useRef(0);
  const seenMembersRef = useRef<Set<string>>(new Set());

  /** Every in-memory view change goes through here, so `viewRef` is always current. */
  const updateView = useCallback((fn: (v: RoomView) => RoomView | null) => {
    const cur = viewRef.current;
    if (!cur) return;
    const next = fn(cur);
    viewRef.current = next;
    setView(next);
  }, []);

  /** The board this client hosts right now, or null. */
  const hostedBoard = useCallback((): BoardState | null => {
    if (!isHostRef.current) return null;
    return role === "host" ? hostBoardRef.current : (viewRef.current?.board ?? null);
  }, [role]);

  const commitPatch = useCallback(
    (patch: IntentPatch, next: BoardState) => {
      if (role === "host") {
        // Mirror first, so a second intent in the same tick sees this one.
        hostBoardRef.current = next;
        onHostUpdateRef.current?.((prev) => applyPatch(prev, patch));
      } else {
        updateView((v) => ({ ...v, board: applyPatch(v.board, patch) }));
      }
    },
    [role, updateView]
  );

  const touch = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdlePrompt(false);
  }, []);

  // ── Host: snapshots ──────────────────────────────────────────────

  const sendSnapshot = useCallback(() => {
    if (!isHostRef.current || !activeRef.current) return;
    const r = roomRef.current;
    if (!r.isConnected) return;
    const board = hostedBoard();
    if (!board) return;
    const now = Date.now();
    const v = viewRef.current;
    const timer =
      role === "host" || !v
        ? { running: board.timerRunning, remaining: board.timerSeconds }
        : { running: v.timer.running, remaining: timerRemaining(v.timer, now) };
    const members: RoomMember[] = [];
    const seen = new Set<string>();
    const self = r.members.find((m) => m.id === selfId);
    members.push({ id: selfId, name: self?.name ?? identity.name });
    seen.add(selfId);
    for (const m of r.members) {
      if (seen.has(m.id) || blockedRef.current.has(m.id)) continue;
      seen.add(m.id);
      members.push({ id: m.id, name: m.name });
    }
    const snap = toRoomSnapshot(board, {
      by: selfId,
      seq: seqRef.current + 1,
      endsAt: endsAtRef.current,
      members,
      votesUsed: ledgerRef.current.votesUsed,
      timer,
      now,
    });
    // Participants refuse anything bigger, so don't spend the quota sending it.
    if (
      snap.cards.length > BOARD_CARD_CAP ||
      !isWithinJsonSize(snap, VISITOR_LIMITS.maxPayloadChars)
    ) {
      if (!sizeWarnedRef.current) {
        sizeWarnedRef.current = true;
        toast.error(
          `This board is too big to share live (${BOARD_CARD_CAP} cards at most). Shorten or remove some cards.`
        );
      }
      return;
    }
    sizeWarnedRef.current = false;
    seqRef.current = snap.seq;
    lastSentRef.current = now;
    r.broadcast(RETRO_ROOM_EVENTS.state, snap);
  }, [hostedBoard, identity.name, role, selfId]);

  /** Send soon: at once if the last snapshot is 500 ms old, else when it will be. */
  const scheduleSnapshot = useCallback(() => {
    if (!isHostRef.current || sendTimerRef.current !== null) return;
    const wait = Math.max(0, SNAPSHOT_THROTTLE_MS - (Date.now() - lastSentRef.current));
    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      sendSnapshot();
    }, wait);
  }, [sendSnapshot]);

  useEffect(
    () => () => {
      if (sendTimerRef.current !== null) clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    },
    []
  );

  // ── Host: ending ─────────────────────────────────────────────────

  const end = useCallback(
    (reason: EndReason = "host") => {
      if (!isHostRef.current || !activeRef.current) return;
      roomRef.current.broadcast(RETRO_ROOM_EVENTS.end, { by: selfId });
      if (sendTimerRef.current !== null) clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
      activeRef.current = false;
      setIdlePrompt(false);
      setEndReason(reason);
      setStatus(reason === "expired" ? "expired" : "ended");
    },
    [selfId]
  );

  // ── Inbound ──────────────────────────────────────────────────────

  const applySnapshot = useCallback((snap: RoomSnapshot) => {
    trustedRef.current = snap.by;
    pendingSnapRef.current = null;
    missingSinceRef.current = null;
    const next: RoomView = {
      board: boardFromSnapshot(snap),
      timer: {
        running: snap.timer.running,
        remaining: snap.timer.remaining,
        anchoredAt: Date.now(),
      },
      members: snap.members,
      votesUsed: snap.votesUsed,
      hostId: snap.hostId,
      endsAt: snap.endsAt,
      seq: snap.seq,
    };
    viewRef.current = next;
    setView(next);
    setHostId(snap.hostId);
    setPendingVotes(0);
    // The host cleared the board: its per-member card allowance starts again too.
    if (snap.cards.length === 0) sentCardsRef.current = 0;
    setStatus((s) => (s === "connecting" ? "live" : s));
  }, []);

  /**
   * Whether a snapshot from `by` may be applied: the trusted host, and only
   * while it is in presence. Pins the host on first use.
   */
  const trusts = useCallback((by: string): boolean => {
    const members = roomRef.current.members;
    const present = (id: string) => members.some((m) => m.id === id);
    const trusted = trustedRef.current;
    if (trusted === null) return present(by);
    if (by === trusted) return present(by);
    // The host has gone: accept the member every peer elects without waiting
    // for this client's own migration timer, so everyone converges at once.
    if (!present(trusted)) {
      const elected = electNewHost(members, trusted);
      if (elected && elected.id === by) {
        trustedRef.current = by;
        return true;
      }
    }
    return false;
  }, []);

  /** Control messages (end, kick) count only from the trusted host while it is present. */
  const fromPresentHost = useCallback(
    (by: string): boolean =>
      by === trustedRef.current && roomRef.current.members.some((m) => m.id === by),
    []
  );

  useEffect(() => {
    const r = roomRef.current;
    const offIntent = r.subscribeToEvent(RETRO_ROOM_EVENTS.intent, (raw) => {
      if (!isHostRef.current || !activeRef.current) return;
      const env = readIntentEnv(raw);
      if (!env || env.by === selfId) return;
      const board = hostedBoard();
      if (!board) return;
      const admitted = new Set<string>();
      for (const m of roomRef.current.members) if (m.id !== selfId) admitted.add(m.id);
      const res = applyIntent(board, ledgerRef.current, env, {
        admitted,
        removed: blockedRef.current,
        newCardId: makeId,
      });
      if (!res.ok) return;
      ledgerRef.current = res.ledger;
      commitPatch(res.patch, res.board);
      touch();
      scheduleSnapshot();
    });
    const offState = r.subscribeToEvent(RETRO_ROOM_EVENTS.state, (raw) => {
      // The host's own board is the only truth: inbound state is never applied.
      if (isHostRef.current || !activeRef.current) return;
      const snap = readRoomSnapshot(raw);
      if (!snap || snap.by === selfId) return;
      if (!trusts(snap.by)) {
        if (trustedRef.current === null) pendingSnapRef.current = snap;
        return;
      }
      applySnapshot(snap);
    });
    const offKick = r.subscribeToEvent(RETRO_ROOM_EVENTS.kick, (raw) => {
      if (isHostRef.current || !activeRef.current) return;
      const msg = readKickMessage(raw);
      if (!msg || msg.id !== selfId || !fromPresentHost(msg.by)) return;
      activeRef.current = false;
      setStatus("kicked");
    });
    const offEnd = r.subscribeToEvent(RETRO_ROOM_EVENTS.end, (raw) => {
      if (isHostRef.current || !activeRef.current) return;
      const msg = readEndMessage(raw);
      if (!msg || !fromPresentHost(msg.by)) return;
      activeRef.current = false;
      setEndReason("host");
      setStatus("ended");
    });
    return () => {
      offIntent();
      offState();
      offKick();
      offEnd();
    };
  }, [
    applySnapshot,
    commitPatch,
    fromPresentHost,
    hostedBoard,
    scheduleSnapshot,
    selfId,
    touch,
    trusts,
  ]);

  // A first snapshot that beat the sender's presence entry: apply it once it shows up.
  useEffect(() => {
    const pending = pendingSnapRef.current;
    if (!pending || isHost || trustedRef.current !== null) return;
    if (room.members.some((m) => m.id === pending.by)) applySnapshot(pending);
  }, [room.members, isHost, applySnapshot]);

  // ── Status from the channel ──────────────────────────────────────

  useEffect(() => {
    if (room.roomFull && active) {
      activeRef.current = false;
      setStatus("full");
    }
  }, [room.roomFull, active]);

  useEffect(() => {
    if (active && room.isLocalOnly) {
      activeRef.current = false;
      setStatus("unavailable");
    }
  }, [active, room.isLocalOnly]);

  useEffect(() => {
    if (role === "host" && room.isConnected) {
      setStatus((s) => (s === "connecting" ? "live" : s));
    }
  }, [role, room.isConnected]);

  // ── Host: send on change, on join, and as a keepalive ────────────

  const liveBoard =
    role === "host" ? (opts.hostBoard ?? null) : promoted ? (view?.board ?? null) : null;
  const signature = useMemo(() => (liveBoard ? roomSignature(liveBoard) : ""), [liveBoard]);
  const emptyBoard = liveBoard !== null && liveBoard.cards.length === 0;

  useEffect(() => {
    if (!isHost || !active || !signature) return;
    // Clear Board (or a fresh board) gives everyone their votes and card allowance back.
    if (emptyBoard) {
      ledgerRef.current = { ...ledgerRef.current, votesUsed: {}, cardsBy: {} };
    }
    touch();
    scheduleSnapshot();
  }, [signature, emptyBoard, isHost, active, touch, scheduleSnapshot]);

  useEffect(() => {
    if (!isHost || !active || !room.isConnected) return;
    const ids = new Set(room.members.map((m) => m.id));
    let joined = false;
    ids.forEach((id) => {
      if (!seenMembersRef.current.has(id)) joined = true;
    });
    const left = Array.from(seenMembersRef.current).some((id) => !ids.has(id));
    seenMembersRef.current = ids;
    if (joined || left) touch();
    if (joined) scheduleSnapshot();
  }, [room.members, room.isConnected, isHost, active, touch, scheduleSnapshot]);

  useEffect(() => {
    if (!isHost || !active || !room.isConnected) return;
    scheduleSnapshot();
    const id = setInterval(sendSnapshot, VISITOR_LIMITS.keepaliveMs);
    return () => clearInterval(id);
  }, [isHost, active, room.isConnected, scheduleSnapshot, sendSnapshot]);

  // ── Host: idle prompt, then end ──────────────────────────────────

  useEffect(() => {
    if (!isHost || !active) return;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= VISITOR_LIMITS.idleMs) setIdlePrompt(true);
    }, IDLE_CHECK_MS);
    return () => clearInterval(id);
  }, [isHost, active]);

  useEffect(() => {
    if (!idlePrompt || !isHost || !active) return;
    const t = setTimeout(() => end("idle"), IDLE_GRACE_MS);
    return () => clearTimeout(t);
  }, [idlePrompt, isHost, active, end]);

  // ── Everyone: the hard TTL ───────────────────────────────────────

  const viewEndsAt = view?.endsAt ?? null;
  useEffect(() => {
    if (!active) return;
    const ownLimit = mountedAtRef.current + VISITOR_LIMITS.hardTtlMs;
    const deadline = isHost
      ? Math.min(endsAtRef.current, role === "host" ? Infinity : ownLimit)
      : Math.min(ownLimit, viewEndsAt ?? Infinity);
    const t = setTimeout(
      () => {
        if (isHostRef.current) {
          end("expired");
        } else {
          activeRef.current = false;
          setEndReason("expired");
          setStatus("expired");
        }
      },
      Math.max(0, deadline - Date.now())
    );
    return () => clearTimeout(t);
  }, [active, isHost, role, viewEndsAt, end]);

  // ── Participant: host migration ──────────────────────────────────

  useEffect(() => {
    if (isHost || !active || !room.isConnected) return;
    const trusted = trustedRef.current;
    if (!trusted || room.members.length === 0) return;
    if (room.members.some((m) => m.id === trusted)) {
      missingSinceRef.current = null;
      return;
    }
    if (missingSinceRef.current === null) missingSinceRef.current = Date.now();
    const wait = Math.max(0, HOST_MIGRATION_DELAY_MS - (Date.now() - missingSinceRef.current));
    const t = setTimeout(() => {
      const members = roomRef.current.members;
      if (trustedRef.current !== trusted || members.some((m) => m.id === trusted)) return;
      if (!hostMissingLongEnough(missingSinceRef.current, Date.now())) return;
      const next = electNewHost(members, trusted);
      if (!next) return;
      missingSinceRef.current = null;
      trustedRef.current = next.id;
      setHostId(next.id);
      if (next.id !== selfId) return;
      // Elected: continue from the last snapshot, in memory only.
      const v = viewRef.current;
      if (!v) return;
      ledgerRef.current = createIntentLedger({ votesUsed: v.votesUsed });
      endsAtRef.current = v.endsAt;
      seqRef.current = v.seq;
      blockedRef.current = new Set();
      isHostRef.current = true;
      updateView((cur) => ({ ...cur, hostId: selfId }));
      setPromoted(true);
      lastActivityRef.current = Date.now();
    }, wait);
    return () => clearTimeout(t);
  }, [room.members, room.isConnected, isHost, active, selfId, updateView]);

  // ── Actions ──────────────────────────────────────────────────────

  /** The promoted host runs its own intents through the same reducer. */
  const applyOwn = useCallback(
    (intent: RetroIntent) => {
      const board = hostedBoard();
      if (!board) return { ok: false as const, reason: "bad-shape" as IntentRejection };
      const env: IntentEnv = { v: 1, by: selfId, intent };
      const res = applyIntent(board, ledgerRef.current, env, {
        admitted: new Set([selfId]),
        removed: new Set(),
        newCardId: makeId,
      });
      if (res.ok) {
        ledgerRef.current = res.ledger;
        commitPatch(res.patch, res.board);
        touch();
        scheduleSnapshot();
      }
      return res;
    },
    [commitPatch, hostedBoard, scheduleSnapshot, selfId, touch]
  );

  const addCard = useCallback(
    (columnKey: string, text: string): AddCardResult => {
      if (!activeRef.current) return "closed";
      const clean = cleanText(text, VISITOR_LIMITS.maxTextChars);
      if (clean === null) return "bad-text";
      const intent: RetroIntent = { t: "card:add", iid: nanoid(12), columnKey, text: clean };
      if (isHostRef.current) {
        const res = applyOwn(intent);
        return res.ok ? "added" : rejectionToResult(res.reason);
      }
      const v = viewRef.current;
      if (!v) return "closed";
      if (!v.members.some((m) => m.id === selfId)) return "not-admitted";
      if (v.board.phase !== "write") return "wrong-phase";
      if (sentCardsRef.current >= MEMBER_CARD_CAP) return "member-cap";
      if (v.board.cards.length >= BOARD_CARD_CAP) return "board-full";
      roomRef.current.broadcast(RETRO_ROOM_EVENTS.intent, { v: 1, by: selfId, intent });
      sentCardsRef.current += 1;
      return "sent";
    },
    [applyOwn, selfId]
  );

  const vote = useCallback(
    (cardId: string): boolean => {
      if (!activeRef.current) return false;
      const intent: RetroIntent = { t: "vote", iid: nanoid(12), cardId };
      if (isHostRef.current) return applyOwn(intent).ok;
      const v = viewRef.current;
      if (!v || v.board.phase !== "vote") return false;
      if (!v.members.some((m) => m.id === selfId)) return false;
      if (!v.board.cards.some((c) => c.id === cardId)) return false;
      const used = (v.votesUsed[selfId] ?? 0) + pendingVotes;
      if (used >= MAX_VOTES) return false;
      roomRef.current.broadcast(RETRO_ROOM_EVENTS.intent, { v: 1, by: selfId, intent });
      setPendingVotes((n) => n + 1);
      return true;
    },
    [applyOwn, pendingVotes, selfId]
  );

  const kick = useCallback(
    (id: string) => {
      if (!isHostRef.current || !activeRef.current || id === selfId) return;
      blockedRef.current.add(id);
      setRemovedVersion((n) => n + 1);
      roomRef.current.broadcast(RETRO_ROOM_EVENTS.kick, { by: selfId, id });
      scheduleSnapshot();
    },
    [scheduleSnapshot, selfId]
  );

  const leave = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setStatus("left");
  }, []);

  const keepOpen = useCallback(() => touch(), [touch]);

  const setPhase = useCallback(
    (phase: BoardPhase) => {
      if (role === "host" || !isHostRef.current) return;
      updateView((v) => ({ ...v, board: { ...v.board, phase } }));
      touch();
    },
    [role, touch, updateView]
  );

  const toggleTimer = useCallback(() => {
    if (role === "host" || !isHostRef.current) return;
    updateView((v) => {
      const now = Date.now();
      const remaining = timerRemaining(v.timer, now);
      const running = !v.timer.running && remaining > 0;
      return {
        ...v,
        timer: { running, remaining, anchoredAt: now },
        board: { ...v.board, timerRunning: running, timerSeconds: remaining },
      };
    });
    touch();
  }, [role, touch, updateView]);

  const setTimerSeconds = useCallback(
    (seconds: number) => {
      if (role === "host" || !isHostRef.current) return;
      const s = Math.max(0, Math.min(24 * 60 * 60, Math.round(seconds)));
      updateView((v) => ({
        ...v,
        timer: { running: false, remaining: s, anchoredAt: Date.now() },
        board: { ...v.board, timerRunning: false, timerSeconds: s },
      }));
      touch();
    },
    [role, touch, updateView]
  );

  const editCard = useCallback(
    (cardId: string, text: string): boolean => {
      if (role === "host" || !isHostRef.current || !activeRef.current) return false;
      const clean = cleanText(text, VISITOR_LIMITS.maxTextChars);
      if (clean === null) return false;
      if (!viewRef.current?.board.cards.some((c) => c.id === cardId)) return false;
      updateView((v) => ({
        ...v,
        board: {
          ...v.board,
          cards: v.board.cards.map((c) => (c.id === cardId ? { ...c, text: clean } : c)),
        },
      }));
      touch();
      return true;
    },
    [role, touch, updateView]
  );

  // ── Result ───────────────────────────────────────────────────────

  const board = role === "host" ? (opts.hostBoard ?? null) : (view?.board ?? null);
  const usedVotes = isHost
    ? (ledgerRef.current.votesUsed[selfId] ?? 0)
    : (view?.votesUsed[selfId] ?? 0) + pendingVotes;
  const hostName =
    hostId === selfId
      ? identity.name
      : (view?.members.find((m) => m.id === hostId)?.name ??
        room.members.find((m) => m.id === hostId)?.name ??
        null);
  // `removedVersion` re-renders the member list after a kick.
  const removedIds = useMemo(
    () => new Set(blockedRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removedVersion, promoted]
  );

  return {
    status,
    endReason,
    isHost,
    promoted,
    selfId,
    hostId,
    hostName,
    board,
    timer: role === "host" ? null : (view?.timer ?? null),
    members: room.members,
    removedIds,
    admitted: isHost || (view?.members.some((m) => m.id === selfId) ?? false),
    votesLeft: Math.max(0, MAX_VOTES - usedVotes),
    endsAt: isHost ? endsAtRef.current : (view?.endsAt ?? null),
    idlePrompt,
    addCard,
    vote,
    kick,
    end,
    keepOpen,
    leave,
    setPhase,
    toggleTimer,
    setTimerSeconds,
    editCard,
  };
}
