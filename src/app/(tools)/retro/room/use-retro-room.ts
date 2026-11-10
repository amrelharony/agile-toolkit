"use client";

/**
 * Retro visitor room: one hook for both ends of the channel.
 *
 * Host (the visitor who pressed "Everyone on their own device"):
 *  - owns the board. Intents from admitted members go through `applyIntent`
 *    against its latest board, then into the board through `onHostUpdate`
 *    (the Board's own updater);
 *  - keeps who added which card and who voted on which card in memory only
 *    (the ledger), so a member can delete their own card or take their own
 *    vote back. No snapshot carries it and the board never saves it;
 *  - "Hide cards while writing" (on by default): during Write a snapshot
 *    carries a count per column instead of the cards, and `hiddenIds` names
 *    the others' cards its own screen hides too. `hidesCard` answers the
 *    same from the ledger when called, so a screen drawing a card that just
 *    arrived hides it in that same render (the ledger changes first);
 *  - never applies an inbound snapshot;
 *  - sends a snapshot at most every 500 ms when the board changes (a timer
 *    tick is not a change), when someone joins, and every 30 s as a
 *    keepalive;
 *  - gives everyone their votes and card allowance back when its own change
 *    empties the board (Clear Board), never when members' deletes do: or
 *    one could delete its own cards and add 30 more, again and again;
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
 *  - remembers the cards it added (their text, while the host hides cards)
 *    and the votes it cast, in memory, so it can show its own cards, delete
 *    them and take its votes back. Each card and vote has a random key that
 *    never leaves this tab until it is used: the add or vote sends its lock
 *    (a hash), the delete or take-back sends the key, so nobody else can
 *    undo them. Once its last request is 2 s old, the host's snapshot wins
 *    over that memory: by card id (a snapshot that hides cards still lists
 *    their ids), a card the host never took is dropped, and a deleted card
 *    the host still has (the delete was refused) comes back. A deleted card
 *    stays in memory until then, so Undo puts it back rather than adding a
 *    copy;
 *  - leaves at the room's 3-hour limit (its own join time + 3 h, or the
 *    host's `endsAt` if sooner): `useRoom` doesn't enforce `hardTtlMs`;
 *  - when elected, continues hosting from the last snapshot, still in memory,
 *    and can fix a card's text there (`editCard`). If the old host left
 *    while cards were hidden, the new host never had them: the room stays in
 *    Write and starts again from the new host's own cards, and everyone is
 *    told to add theirs again (`cardsLost`). A new host knows nothing of who
 *    added or voted on what before it took over.
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
import { MAX_VOTES, type BoardPhase, type BoardState, type RetroCard } from "../types";
import {
  applyIntent,
  applyPatch,
  createIntentLedger,
  ownerOfCard,
  resetAllowances,
  retireIds,
  type IntentLedger,
  type IntentPatch,
  type IntentRejection,
} from "./intents";
import {
  BOARD_CARD_CAP,
  IDLE_GRACE_MS,
  MEMBER_CARD_CAP,
  RETRO_ROOM_EVENTS,
  RETRO_ROOM_PROTOCOL_VERSION,
  SNAPSHOT_THROTTLE_MS,
  cardsHidden,
  readEndMessage,
  readIntentEnv,
  readKickMessage,
  lockOf,
  otherVersionSender,
  type IntentEnv,
  type RetroIntent,
  type RoomMember,
  type RoomSnapshot,
} from "./protocol";
import { boardFromSnapshot, readRoomSnapshot, roomSignature, toRoomSnapshot } from "./snapshot";
import { hideCards, hiddenTotal } from "./hidden";

/** How often the host checks whether the room has gone idle. */
const IDLE_CHECK_MS = 30_000;

/**
 * Once a participant's last request is this old, the host's snapshot has
 * answered it, so the snapshot wins over what the participant remembers.
 */
export const SETTLE_MS = 2_000;

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

/** A card this tab added through the room, as it remembers it. */
export interface OwnCard {
  id: string;
  columnKey: string;
  text: string;
}

/** An own card with the key that deletes it (the add sent its lock). Never leaves this tab. */
interface HeldCard extends OwnCard {
  key: string;
  /**
   * Undo was pressed before its delete settled: if the delete turns out to
   * have gone through, the card is added again, as a new card.
   */
  revive?: boolean;
}

/** A vote this tab cast, with the key that takes it back (the vote sent its lock). */
interface HeldVote {
  cardId: string;
  key: string;
}

/** A new random key for a card or a vote. */
const newKey = (): string => nanoid(21);

/** The participant's (or promoted host's) in-memory room. */
interface RoomView {
  board: BoardState;
  timer: RoomTimerView;
  members: RoomMember[];
  votesUsed: Record<string, number>;
  hostId: string;
  endsAt: number;
  seq: number;
  /** The host's "Hide cards while writing" setting. */
  hideWhileWriting: boolean;
  /** While the host hides the cards: its count per column (everyone's, this tab's included). */
  counts: Record<string, number> | null;
  /** While the host hides the cards: the ids of every card it holds. */
  ids: ReadonlySet<string> | null;
  votesPerPerson: number;
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
  /**
   * Host: `hostBoard`. Participant: the last snapshot, in memory (no cards
   * while the host hides them). Null before the first one.
   */
  board: BoardState | null;
  /**
   * The cards this screen shows: the board's, or while cards are hidden,
   * this client's own (a host: all but the others' hidden ones). Null
   * before the first snapshot.
   */
  shownCards: RetroCard[] | null;
  /** While cards are hidden from this screen: how many each column hides. Null otherwise. */
  hiddenCounts: Record<string, number> | null;
  /** Hosting: ids of the others' cards this host's screen hides right now, or null. */
  hiddenIds: ReadonlySet<string> | null;
  /**
   * Hosting with hiding on: whether a card is one of the others', read from
   * the ledger when called. The ledger changes before the board does, so a
   * screen that asks while drawing a card that just arrived already hides
   * it. The caller checks the phase (cards hide only in Write). Null when
   * nothing is hidden: hiding off, or not hosting. Stable while those hold.
   */
  hidesCard: ((cardId: string) => boolean) | null;
  /** The host's "Hide cards while writing" setting (this client's own when hosting). */
  hideWhileWriting: boolean;
  /** Ids of cards this client added through the room, which it may delete in Write. */
  ownIds: ReadonlySet<string>;
  /** Votes this client cast through the room, per card, as far as it knows. */
  myVotes: Readonly<Record<string, number>>;
  /** The host left during Write while cards were hidden, so the cards written so far were lost. */
  cardsLost: boolean;
  /**
   * Participant, still connecting: the host's state came in another protocol
   * version (one of the two tabs runs an older build), so it can't be read.
   */
  otherVersion: boolean;
  /** Participant: its cards from before the host left, to add again. */
  unsharedCards: OwnCard[];
  /** Participant and promoted host: the countdown. Null for the host (its board has the timer). */
  timer: RoomTimerView | null;
  /** People in the channel, as `useRoom` seats them (at most 20). */
  members: PresenceMember[];
  /** Ids the host removed (host only). */
  removedIds: ReadonlySet<string>;
  /** Participant: the host's snapshot lists this client, so its intents count. */
  admitted: boolean;
  /** Votes each person has. */
  votesPerPerson: number;
  /** Votes this client has left in the Vote phase. */
  votesLeft: number;
  /** When the room closes for everyone (epoch ms), once known. */
  endsAt: number | null;
  /** Host: the room has been idle 30 minutes and will end unless kept open. */
  idlePrompt: boolean;
  addCard: (columnKey: string, text: string) => AddCardResult;
  /** Participant: add one of `unsharedCards` again (it leaves the list once sent). */
  addAgain: (id: string) => AddCardResult;
  /**
   * "Delete my card": a card this client added, in Write. The starting host
   * deletes through its own Board, so this is false for it.
   */
  deleteCard: (cardId: string) => boolean;
  /**
   * Undo of "Delete my card". A card whose delete hasn't settled comes back
   * as it was (and is added again only if the delete did go through); after
   * a settled delete it is added again as a new card.
   */
  undoDelete: (card: OwnCard) => AddCardResult;
  vote: (cardId: string) => boolean;
  /** "Take my vote back": one of this client's votes on `cardId`, in Vote. False for the starting host. */
  unvote: (cardId: string) => boolean;
  /** Hosting: switch "Hide cards while writing". */
  setHideWhileWriting: (on: boolean) => void;
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

const NO_IDS: ReadonlySet<string> = new Set<string>();

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

function ownToCard(c: OwnCard): RetroCard {
  return {
    id: c.id,
    columnKey: c.columnKey,
    text: c.text,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
  };
}

/** Votes per card from a list of card ids (built from entries, so every id is an own key). */
function countVotes(list: readonly string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1);
  return Object.fromEntries(counts);
}

function sumCounts(counts: Readonly<Record<string, number>> | null): number {
  return hiddenTotal(counts);
}

export function useRetroRoom(opts: UseRetroRoomOptions): RetroRoom {
  const { code, identity, role } = opts;
  const selfId = identity.id;

  const [status, setStatus] = useState<RetroRoomStatus>("connecting");
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [promoted, setPromoted] = useState(false);
  const [view, setView] = useState<RoomView | null>(null);
  /** Votes cast (+1) and taken back (−1) since the last snapshot. */
  const [pendingVotes, setPendingVotes] = useState(0);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [removedVersion, setRemovedVersion] = useState(0);
  const [hostId, setHostId] = useState<string | null>(role === "host" ? selfId : null);
  /** "Hide cards while writing", while this client hosts. */
  const [hide, setHide] = useState(true);
  /** Bumped when the ledger changes, so what derives from it re-renders. */
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const [ownCards, setOwnCardsState] = useState<HeldCard[]>([]);
  const [myVoteList, setMyVoteListState] = useState<HeldVote[]>([]);
  const [unsharedCards, setUnsharedState] = useState<OwnCard[]>([]);
  /** Participant: own cards whose delete is on its way, until a settled snapshot says how it went. */
  const [deleting, setDeletingState] = useState<HeldCard[]>([]);
  const [cardsLost, setCardsLost] = useState(false);
  /** Participant: the host's state is of another protocol version (a tab on another build). */
  const [otherVersion, setOtherVersion] = useState(false);

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
  const hideRef = useRef(hide);
  hideRef.current = hide;

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
  /** Participant: when it last sent an intent (epoch ms). */
  const lastIntentAtRef = useRef(0);
  const ownCardsRef = useRef<HeldCard[]>([]);
  const myVotesRef = useRef<HeldVote[]>([]);
  const unsharedRef = useRef<OwnCard[]>([]);
  const deletingRef = useRef<HeldCard[]>([]);
  /** `addCard`, for the reconcile that re-adds a card undone before its delete settled. */
  const addCardRef = useRef<((columnKey: string, text: string) => AddCardResult) | null>(null);
  /** Host: the card ids on its board at the last change, to notice cards that leave it. */
  const boardIdsRef = useRef<Set<string> | null>(null);
  /** Host: cards members deleted through the room since the last board change. */
  const intentDeletedRef = useRef<Set<string>>(new Set());
  /** Participant: "Delete my card" requests sent since the last snapshot. */
  const deletesSinceSnapRef = useRef(0);

  // Each memory list has a ref (read by handlers) and state (renders); set both together.
  const setOwnCards = useCallback((next: HeldCard[]) => {
    ownCardsRef.current = next;
    setOwnCardsState(next);
  }, []);
  const setMyVotes = useCallback((next: HeldVote[]) => {
    myVotesRef.current = next;
    setMyVoteListState(next);
  }, []);
  const setUnshared = useCallback((next: OwnCard[]) => {
    unsharedRef.current = next;
    setUnsharedState(next);
  }, []);
  const setDeleting = useCallback((next: HeldCard[]) => {
    deletingRef.current = next;
    setDeletingState(next);
  }, []);
  const setLedger = useCallback((next: IntentLedger) => {
    if (next === ledgerRef.current) return;
    ledgerRef.current = next;
    setLedgerVersion((n) => n + 1);
  }, []);

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

  /** Votes each person has: the board's when it started the room, else the snapshot's. */
  const budget = useCallback(
    (): number => (role === "host" ? MAX_VOTES : (viewRef.current?.votesPerPerson ?? MAX_VOTES)),
    [role]
  );

  const commitPatch = useCallback(
    (patch: IntentPatch, next: BoardState) => {
      // A board a member's delete empties wasn't cleared: allowances stay.
      if (patch.t === "card:delete") intentDeletedRef.current.add(patch.cardId);
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
      hideWhileWriting: hideRef.current,
      votesPerPerson: budget(),
    });
    // Participants refuse anything bigger, so don't spend the quota sending it.
    if (
      snap.cards.length + sumCounts(snap.counts) > BOARD_CARD_CAP ||
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
  }, [budget, hostedBoard, identity.name, role, selfId]);

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

  /**
   * Bring what this participant remembers in line with the host's snapshot,
   * once its own last request has had time to land, by card id: cards and
   * votes the host doesn't have are dropped, a delete the host refused gives
   * the card back, and a card undone before its delete settled is added
   * again if the delete went through. A board that just emptied, by more
   * than this tab's own deletes, was cleared, so the card allowance starts
   * again too, as it does on the host's side.
   */
  const reconcile = useCallback(
    (snap: RoomSnapshot, before: number, ownDeletes: number) => {
      const hidden = cardsHidden(snap);
      const total = snap.cards.length + sumCounts(snap.counts);
      const settled = Date.now() - lastIntentAtRef.current >= SETTLE_MS;
      if (total === 0 && before > ownDeletes) sentCardsRef.current = 0;
      if (!settled) return;
      if (total === 0) {
        // Cleared: nothing of this tab's is left, and nothing comes back.
        if (ownCardsRef.current.length > 0) setOwnCards([]);
        if (deletingRef.current.length > 0) setDeleting([]);
        if (myVotesRef.current.length > 0) setMyVotes([]);
        return;
      }
      // While cards are hidden the snapshot still lists their ids.
      const ids = new Set(hidden ? snap.ids : snap.cards.map((c) => c.id));
      // A delete the host refused leaves the card on its board: it is this tab's again.
      const refused = deletingRef.current.filter((c) => ids.has(c.id));
      if (deletingRef.current.length > 0) setDeleting([]);
      const own = ownCardsRef.current;
      const keep: HeldCard[] = [];
      const readd: HeldCard[] = [];
      for (const c of [...own, ...refused]) {
        if (ids.has(c.id)) keep.push(c.revive ? { ...c, revive: false } : c);
        // Undone before its delete settled, and the delete went through: add it again.
        else if (c.revive) readd.push(c);
        // Otherwise it never landed (or was lost): the host's board wins.
      }
      if (keep.length !== own.length || keep.some((c, i) => c !== own[i])) setOwnCards(keep);
      for (const c of readd) addCardRef.current?.(c.columnKey, c.text);

      let votes = myVotesRef.current;
      votes = votes.filter((v) => ids.has(v.cardId));
      const confirmed = Object.prototype.hasOwnProperty.call(snap.votesUsed, selfId)
        ? snap.votesUsed[selfId]
        : 0;
      if (votes.length > confirmed) votes = votes.slice(0, confirmed);
      if (votes.length !== myVotesRef.current.length) setMyVotes(votes);
    },
    [selfId, setDeleting, setMyVotes, setOwnCards]
  );

  const applySnapshot = useCallback(
    (snap: RoomSnapshot) => {
      const prev = viewRef.current;
      const before = prev ? prev.board.cards.length + sumCounts(prev.counts) : 0;
      const ownDeletes = deletesSinceSnapRef.current;
      deletesSinceSnapRef.current = 0;
      trustedRef.current = snap.by;
      pendingSnapRef.current = null;
      missingSinceRef.current = null;
      const hidden = cardsHidden(snap);
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
        hideWhileWriting: snap.hideWhileWriting,
        counts: hidden ? snap.counts : null,
        ids: hidden ? new Set(snap.ids) : null,
        votesPerPerson: snap.votesPerPerson,
      };
      viewRef.current = next;
      setView(next);
      setHostId(snap.hostId);
      setPendingVotes(0);
      setOtherVersion(false);
      if (prev && prev.hostId !== snap.hostId) {
        // A new host knows nothing of who added or voted on what before it.
        // If cards were hidden, it never had them either: keep this tab's
        // text so the person can add those cards again.
        if (prev.counts !== null && snap.phase === "write") {
          const lost = [
            ...unsharedRef.current,
            ...ownCardsRef.current.map(({ id, columnKey, text }) => ({ id, columnKey, text })),
          ];
          setUnshared(lost);
          setCardsLost(true);
        }
        setOwnCards([]);
        setDeleting([]);
        setMyVotes([]);
        sentCardsRef.current = 0;
      } else {
        reconcile(snap, before, ownDeletes);
      }
      if (snap.phase !== "write") {
        setCardsLost(false);
        if (unsharedRef.current.length > 0) setUnshared([]);
      }
      setStatus((s) => (s === "connecting" ? "live" : s));
    },
    [reconcile, setDeleting, setMyVotes, setOwnCards, setUnshared]
  );

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
        votesPerPerson: budget(),
      });
      if (!res.ok) return;
      setLedger(res.ledger);
      commitPatch(res.patch, res.board);
      touch();
      scheduleSnapshot();
    });
    const offState = r.subscribeToEvent(RETRO_ROOM_EVENTS.state, (raw) => {
      // The host's own board is the only truth: inbound state is never applied.
      if (isHostRef.current || !activeRef.current) return;
      const snap = readRoomSnapshot(raw);
      if (!snap) {
        // Refused on its version, once per message: say why the board never comes,
        // while this tab still waits for a host and the sender is in the room.
        const by = otherVersionSender(raw);
        if (
          by !== null &&
          by !== selfId &&
          trustedRef.current === null &&
          roomRef.current.members.some((m) => m.id === by)
        ) {
          setOtherVersion(true);
        }
        return;
      }
      if (snap.by === selfId) return;
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
    budget,
    commitPatch,
    fromPresentHost,
    hostedBoard,
    scheduleSnapshot,
    selfId,
    setLedger,
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
  const signature = useMemo(
    () => (liveBoard ? roomSignature(liveBoard, hide) : ""),
    [liveBoard, hide]
  );

  useEffect(() => {
    if (!isHost || !active || !signature) return;
    touch();
    scheduleSnapshot();
  }, [signature, isHost, active, touch, scheduleSnapshot]);

  // Cards that leave the board (deleted, cleared) can't lend their ids to a new card:
  // an Undo on this side could bring them back. A board this host's own change
  // empties (Clear Board) gives everyone their votes and card allowance back;
  // one the members' own deletes empty doesn't.
  useEffect(() => {
    if (!isHost || !liveBoard) {
      boardIdsRef.current = null;
      intentDeletedRef.current = new Set();
      return;
    }
    const ids = new Set(liveBoard.cards.map((c) => c.id));
    const byIntent = intentDeletedRef.current;
    // Keep the members' deletes still to land (their card is still here); drop the rest.
    intentDeletedRef.current = new Set(Array.from(byIntent).filter((id) => ids.has(id)));
    const before = boardIdsRef.current;
    boardIdsRef.current = ids;
    if (!before) return;
    const gone: string[] = [];
    before.forEach((id) => {
      if (!ids.has(id)) gone.push(id);
    });
    if (gone.length === 0) return;
    const retired = retireIds(ledgerRef.current, gone);
    if (ids.size === 0 && gone.some((id) => !byIntent.has(id))) {
      setLedger(resetAllowances(retired));
    } else {
      ledgerRef.current = retired;
    }
  }, [isHost, liveBoard, setLedger]);

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
      // The old host hid the cards and took them with it: start again from this tab's own.
      const lost = v.counts !== null;
      let board = v.board;
      if (lost) {
        const keys = new Set(board.format.columns.map((c) => c.key));
        board = {
          ...board,
          cards: ownCardsRef.current
            .filter((c) => keys.has(c.columnKey))
            .slice(0, BOARD_CARD_CAP)
            .map(ownToCard),
        };
      } else if (deletingRef.current.length > 0) {
        // Its own deletes still on their way: this board is the one that counts now.
        const gone = new Set(deletingRef.current.map((c) => c.id));
        board = {
          ...board,
          cards: board.cards
            .filter((c) => !gone.has(c.id))
            .map((c) =>
              c.groupedWith !== null && gone.has(c.groupedWith) ? { ...c, groupedWith: null } : c
            ),
        };
      }
      // Its own cards and votes stay its own; nobody else's are known.
      const onBoard = new Set(board.cards.map((c) => c.id));
      const ownerOf: Record<string, string> = {};
      let mine = 0;
      for (const c of ownCardsRef.current) {
        if (!onBoard.has(c.id)) continue;
        ownerOf[c.id] = selfId;
        mine += 1;
      }
      // Its own votes keep their locks: lost cards took everyone's votes with them.
      const myLocks = new Map<string, string[]>();
      if (!lost) {
        for (const mv of myVotesRef.current) {
          if (!onBoard.has(mv.cardId)) continue;
          myLocks.set(mv.cardId, [...(myLocks.get(mv.cardId) ?? []), lockOf(mv.key)]);
        }
      }
      const seeded = createIntentLedger({
        // Lost cards took their votes with them: everyone's come back.
        votesUsed: lost ? {} : v.votesUsed,
        votesPerPerson: v.votesPerPerson,
      });
      setLedger({
        ...seeded,
        ownerOf,
        cardsBy: mine > 0 ? { [selfId]: mine } : {},
        voteLocks: myLocks.size > 0 ? { [selfId]: Object.fromEntries(myLocks) } : {},
      });
      endsAtRef.current = v.endsAt;
      seqRef.current = v.seq;
      blockedRef.current = new Set();
      isHostRef.current = true;
      hideRef.current = v.hideWhileWriting;
      setHide(v.hideWhileWriting);
      updateView((cur) => ({ ...cur, board, hostId: selfId, counts: null, ids: null }));
      setOwnCards([]);
      setDeleting([]);
      setMyVotes([]);
      setPendingVotes(0);
      if (lost) setCardsLost(true);
      setPromoted(true);
      lastActivityRef.current = Date.now();
    }, wait);
    return () => clearTimeout(t);
  }, [
    room.members,
    room.isConnected,
    isHost,
    active,
    selfId,
    setDeleting,
    setLedger,
    setMyVotes,
    setOwnCards,
    updateView,
  ]);

  // ── Actions ──────────────────────────────────────────────────────

  /**
   * The promoted host runs its own intents through the same reducer, as its
   * own (`local`): no key is asked for, and the channel's handler drops any
   * message that claims to come from this tab.
   */
  const applyOwn = useCallback(
    (intent: RetroIntent) => {
      const board = hostedBoard();
      if (!board) return { ok: false as const, reason: "bad-shape" as IntentRejection };
      const env: IntentEnv = { v: RETRO_ROOM_PROTOCOL_VERSION, by: selfId, intent };
      const res = applyIntent(board, ledgerRef.current, env, {
        admitted: new Set([selfId]),
        removed: new Set(),
        votesPerPerson: budget(),
        local: true,
      });
      if (res.ok) {
        setLedger(res.ledger);
        commitPatch(res.patch, res.board);
        touch();
        scheduleSnapshot();
      }
      return res;
    },
    [budget, commitPatch, hostedBoard, scheduleSnapshot, selfId, setLedger, touch]
  );

  /** A participant's request to the host. */
  const send = useCallback(
    (intent: RetroIntent) => {
      roomRef.current.broadcast(RETRO_ROOM_EVENTS.intent, {
        v: RETRO_ROOM_PROTOCOL_VERSION,
        by: selfId,
        intent,
      });
      lastIntentAtRef.current = Date.now();
    },
    [selfId]
  );

  /** The participant's view, if it may act in `phase` (has a seat). */
  const seatedView = useCallback(
    (phase: BoardPhase): RoomView | null => {
      const v = viewRef.current;
      if (!v || v.board.phase !== phase) return null;
      return v.members.some((m) => m.id === selfId) ? v : null;
    },
    [selfId]
  );

  const addCard = useCallback(
    (columnKey: string, text: string): AddCardResult => {
      if (!activeRef.current) return "closed";
      const clean = cleanText(text, VISITOR_LIMITS.maxTextChars);
      if (clean === null) return "bad-text";
      // The request's id becomes the card's id: this tab's handle on its own card.
      // The key stays here; its lock goes with the card, so only this tab can delete it.
      const iid = nanoid(12);
      const key = newKey();
      const intent: RetroIntent = { t: "card:add", iid, columnKey, text: clean, lock: lockOf(key) };
      if (isHostRef.current) {
        const res = applyOwn(intent);
        return res.ok ? "added" : rejectionToResult(res.reason);
      }
      const v = viewRef.current;
      if (!v) return "closed";
      if (!v.members.some((m) => m.id === selfId)) return "not-admitted";
      if (v.board.phase !== "write") return "wrong-phase";
      if (sentCardsRef.current >= MEMBER_CARD_CAP) return "member-cap";
      if (v.board.cards.length + sumCounts(v.counts) >= BOARD_CARD_CAP) return "board-full";
      send(intent);
      sentCardsRef.current += 1;
      setOwnCards([...ownCardsRef.current, { id: iid, columnKey, text: clean, key }]);
      return "sent";
    },
    [applyOwn, selfId, send, setOwnCards]
  );

  addCardRef.current = addCard;

  const addAgain = useCallback(
    (id: string): AddCardResult => {
      const c = unsharedRef.current.find((u) => u.id === id);
      if (!c) return "closed";
      const res = addCard(c.columnKey, c.text);
      if (res === "sent" || res === "added") {
        setUnshared(unsharedRef.current.filter((u) => u.id !== id));
      }
      return res;
    },
    [addCard, setUnshared]
  );

  const deleteCard = useCallback(
    (cardId: string): boolean => {
      if (!activeRef.current || role === "host") return false;
      if (isHostRef.current) {
        return applyOwn({ t: "card:delete", iid: nanoid(12), cardId, key: newKey() }).ok;
      }
      if (!seatedView("write")) return false;
      const own = ownCardsRef.current.find((c) => c.id === cardId);
      if (!own) return false;
      send({ t: "card:delete", iid: nanoid(12), cardId, key: own.key });
      deletesSinceSnapRef.current += 1;
      // Off the screen at once, but kept until a settled snapshot shows how the delete went.
      setOwnCards(ownCardsRef.current.filter((c) => c.id !== cardId));
      setDeleting([...deletingRef.current, { ...own, revive: false }]);
      return true;
    },
    [applyOwn, role, seatedView, send, setDeleting, setOwnCards]
  );

  const undoDelete = useCallback(
    (card: OwnCard): AddCardResult => {
      if (!activeRef.current) return "closed";
      const pending = deletingRef.current.find((c) => c.id === card.id);
      if (pending) {
        // Not settled yet: back on the screen now, and added again only if the delete went through.
        setDeleting(deletingRef.current.filter((c) => c.id !== card.id));
        setOwnCards([...ownCardsRef.current, { ...pending, revive: true }]);
        return "sent";
      }
      // The host refused the delete, and the card is back already.
      if (ownCardsRef.current.some((c) => c.id === card.id)) return "sent";
      return addCard(card.columnKey, card.text);
    },
    [addCard, setDeleting, setOwnCards]
  );

  const vote = useCallback(
    (cardId: string): boolean => {
      if (!activeRef.current) return false;
      const key = newKey();
      const intent: RetroIntent = { t: "vote", iid: nanoid(12), cardId, lock: lockOf(key) };
      if (isHostRef.current) return applyOwn(intent).ok;
      const v = seatedView("vote");
      if (!v || !v.board.cards.some((c) => c.id === cardId)) return false;
      const used = (v.votesUsed[selfId] ?? 0) + pendingVotes;
      if (used >= v.votesPerPerson) return false;
      send(intent);
      setMyVotes([...myVotesRef.current, { cardId, key }]);
      setPendingVotes((n) => n + 1);
      return true;
    },
    [applyOwn, pendingVotes, seatedView, selfId, send, setMyVotes]
  );

  const unvote = useCallback(
    (cardId: string): boolean => {
      if (!activeRef.current || role === "host") return false;
      if (isHostRef.current) {
        return applyOwn({ t: "vote:undo", iid: nanoid(12), cardId, key: newKey() }).ok;
      }
      if (!seatedView("vote")) return false;
      const list = myVotesRef.current;
      let at = -1;
      for (let i = list.length - 1; i >= 0 && at < 0; i--) if (list[i].cardId === cardId) at = i;
      if (at < 0) return false;
      send({ t: "vote:undo", iid: nanoid(12), cardId, key: list[at].key });
      setMyVotes([...list.slice(0, at), ...list.slice(at + 1)]);
      setPendingVotes((n) => n - 1);
      return true;
    },
    [applyOwn, role, seatedView, send, setMyVotes]
  );

  const setHideWhileWriting = useCallback(
    (on: boolean) => {
      if (!isHostRef.current || !activeRef.current) return;
      hideRef.current = on;
      setHide(on);
      touch();
    },
    [touch]
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
      if (phase !== "write") setCardsLost(false);
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
  const livePhase = liveBoard?.phase ?? null;

  // The others' cards a host's screen hides: the room's own record of who added what.
  const hiddenIds = useMemo((): ReadonlySet<string> | null => {
    if (!isHost || !hide || livePhase !== "write") return null;
    const ids = new Set<string>();
    for (const [cardId, owner] of Object.entries(ledgerRef.current.ownerOf)) {
      if (owner !== selfId) ids.add(cardId);
    }
    return ids;
    // `ledgerVersion` stands for the ledger, which lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, hide, livePhase, ledgerVersion, selfId]);

  const hidesCard = useMemo(
    () =>
      isHost && hide
        ? (cardId: string): boolean => {
            const owner = ownerOfCard(ledgerRef.current, cardId);
            return owner !== null && owner !== selfId;
          }
        : null,
    [isHost, hide, selfId]
  );

  const shown = useMemo((): {
    cards: RetroCard[] | null;
    counts: Record<string, number> | null;
  } => {
    if (isHost) {
      if (!liveBoard) return { cards: null, counts: null };
      const h = hideCards(liveBoard.cards, hiddenIds);
      return { cards: h.shown, counts: h.hiddenCounts };
    }
    if (!view) return { cards: null, counts: null };
    if (view.counts === null) return { cards: view.board.cards, counts: null };
    // Cards are hidden: this tab's own, and a count of the rest per column.
    const keys = view.board.format.columns.map((c) => c.key);
    const cards = ownCards.filter((c) => keys.includes(c.columnKey)).map(ownToCard);
    // The host counts this tab's cards it has (by id), deleted ones still on their way included.
    const counted = [...ownCards, ...deleting].filter((c) => view.ids?.has(c.id) ?? false);
    const counts: Record<string, number> = {};
    for (const key of keys) {
      const all = Object.prototype.hasOwnProperty.call(view.counts, key) ? view.counts[key] : 0;
      const mine = counted.filter((c) => c.columnKey === key).length;
      counts[key] = Math.max(0, all - mine);
    }
    return { cards, counts };
  }, [deleting, hiddenIds, isHost, liveBoard, ownCards, view]);

  const ownIds = useMemo((): ReadonlySet<string> => {
    if (role === "host") return NO_IDS;
    if (promoted) {
      const ids = new Set<string>();
      for (const [cardId, owner] of Object.entries(ledgerRef.current.ownerOf)) {
        if (owner === selfId) ids.add(cardId);
      }
      return ids;
    }
    return new Set(ownCards.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, promoted, ownCards, ledgerVersion, selfId]);

  const myVotes = useMemo((): Readonly<Record<string, number>> => {
    if (role === "host") return {};
    if (promoted) {
      const all = ledgerRef.current.voteLocks;
      if (!Object.prototype.hasOwnProperty.call(all, selfId)) return {};
      return Object.fromEntries(
        Object.entries(all[selfId]).map(([cardId, locks]) => [cardId, locks.length])
      );
    }
    return countVotes(myVoteList.map((mv) => mv.cardId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, promoted, myVoteList, ledgerVersion, selfId]);

  const votesPerPerson = role === "host" ? MAX_VOTES : (view?.votesPerPerson ?? MAX_VOTES);
  const usedVotes = isHost
    ? (ledgerRef.current.votesUsed[selfId] ?? 0)
    : Math.max(0, (view?.votesUsed[selfId] ?? 0) + pendingVotes);
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
    shownCards: shown.cards,
    hiddenCounts: shown.counts,
    hiddenIds,
    hidesCard,
    hideWhileWriting: isHost ? hide : (view?.hideWhileWriting ?? true),
    ownIds,
    myVotes,
    cardsLost,
    unsharedCards,
    otherVersion,
    timer: role === "host" ? null : (view?.timer ?? null),
    members: room.members,
    removedIds,
    admitted: isHost || (view?.members.some((m) => m.id === selfId) ?? false),
    votesPerPerson,
    votesLeft: Math.max(0, votesPerPerson - usedVotes),
    endsAt: isHost ? endsAtRef.current : (view?.endsAt ?? null),
    idlePrompt,
    addCard,
    addAgain,
    deleteCard,
    undoDelete,
    vote,
    unvote,
    setHideWhileWriting,
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
