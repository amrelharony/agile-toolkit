/**
 * Retro visitor room: the wire protocol (version 2).
 *
 * The room is host-authoritative. The person who pressed "Everyone on their
 * own device" owns the board; everyone else sends intents and renders the
 * host's snapshots.
 *
 *   participant → host   "retro:intent"  IntentEnv   (add or delete my card,
 *                                        cast or take back a vote)
 *   host → everyone      "retro:state"   RoomSnapshot (throttled 500 ms, on
 *                                        member join, 30 s keepalive)
 *   host → everyone      "retro:kick"    KickMessage  (soft removal)
 *   host → everyone      "retro:end"     EndMessage
 *
 * Version 2 hides cards while people write: with the host's "Hide cards
 * while writing" on (the default), a Write-phase snapshot carries a count
 * per column instead of the cards, and each tab shows its own cards from
 * memory. It also carries the column list with labels and the votes each
 * person has. A tab on version 1 refuses every version 2 message on its
 * `v`, and this version refuses theirs the same way.
 *
 * No message the host sends says who wrote a card or cast a vote. Who owns
 * what is a host-side record in memory (`intents.ts`), never shared or
 * saved. A card added through the room takes its add request's id as its
 * card id: a random id the sender made, which is how the sender finds its
 * own card later.
 *
 * Every peer receives every request, so `by` alone can't prove a card or a
 * vote is the sender's. Adding a card or casting a vote sends a lock, the
 * SHA-256 of a random key only the sender's tab holds; deleting that card or
 * taking that vote back sends the key, and the host checks it against the
 * lock. A key and its lock belong to one card or one vote, so they say
 * nothing about who sent them.
 *
 * Every inbound message is untrusted: `by` is self-declared, so these readers
 * check shape and size only. Who may send what is decided by the reducer
 * (`intents.ts`) and the hook (`use-retro-room.ts`).
 *
 * Pure, no browser globals.
 */

import { sha256Base64Url } from "@/lib/realtime/sha256";
import { VISITOR_LIMITS, isVisitorMemberId } from "@/lib/realtime/visitor-rooms";
import { isExampleId } from "@/lib/utils/example-id";
import type { BoardPhase, RetroCard } from "../types";

export const RETRO_ROOM_EVENTS = {
  intent: "retro:intent",
  state: "retro:state",
  kick: "retro:kick",
  end: "retro:end",
} as const;

export const RETRO_ROOM_PROTOCOL_VERSION = 2 as const;

// ── Limits ───────────────────────────────────────────────────────────

/** Cards one member may add through the room (deleting one doesn't give it back). */
export const MEMBER_CARD_CAP = 30;
/** Votes one member may take back through the room. */
export const MEMBER_UNDO_CAP = 30;
/** Cards on the board, host's own included, before the room stops taking more. */
export const BOARD_CARD_CAP = 200;
/** How many recent intent ids the host remembers to drop duplicates. */
export const INTENT_ID_RING = 256;
/** How many ids of cards that left the board the host remembers, so no new card takes one. */
export const RETIRED_ID_RING = 512;
/** Shortest gap between two snapshots from the host. */
export const SNAPSHOT_THROTTLE_MS = 500;
/** After the idle prompt shows, the host has this long before the room ends. */
export const IDLE_GRACE_MS = VISITOR_LIMITS.idleGraceMs;
/** Longest intent id accepted (participants send nanoid(12)). */
export const MAX_INTENT_ID_CHARS = 32;
/** Raw card text longer than this is rejected before it's cleaned. */
export const MAX_RAW_TEXT_CHARS = 2_000;
/** Card ids and column keys (`readRetro` accepts up to 64). */
export const MAX_KEY_CHARS = 64;
/** Columns on a board, as `readRetro` caps formats. */
export const MAX_COLUMNS = 12;
/** Column labels, as `readRetro` caps them. */
export const MAX_COLUMN_LABEL_CHARS = 200;
/** Most votes a snapshot may give each person. */
export const MAX_VOTES_PER_PERSON = 20;

// ── Messages ─────────────────────────────────────────────────────────

/**
 * What a participant may ask. `card:add` makes a card whose id is `iid`;
 * `card:delete` names one of the sender's own cards by that id. Adding and
 * voting send a `lock` (`lockOf` a key the sender keeps); deleting that card
 * or taking that vote back sends the `key`.
 */
export type RetroIntent =
  | { t: "card:add"; iid: string; columnKey: string; text: string; lock: string }
  | { t: "card:delete"; iid: string; cardId: string; key: string }
  | { t: "vote"; iid: string; cardId: string; lock: string }
  | { t: "vote:undo"; iid: string; cardId: string; key: string };

export interface IntentEnv {
  v: typeof RETRO_ROOM_PROTOCOL_VERSION;
  by: string;
  intent: RetroIntent;
}

/** A card as the room shares it: no hand-off links, no carry-over ids, no author. */
export type RoomCard = Pick<
  RetroCard,
  "id" | "columnKey" | "text" | "votes" | "groupedWith" | "isActionItem" | "assignee" | "discussing"
>;

/** A column as the room shares it: no colour or icon. */
export interface RoomColumn {
  key: string;
  label: string;
}

export interface RoomTimer {
  running: boolean;
  /** Seconds left when the snapshot was taken. */
  remaining: number;
  /** Host clock (epoch ms) when the snapshot was taken. Participants anchor on receipt instead. */
  at: number;
}

export interface RoomMember {
  id: string;
  name: string;
}

export interface RoomSnapshot {
  v: typeof RETRO_ROOM_PROTOCOL_VERSION;
  by: string;
  seq: number;
  hostId: string;
  /** Epoch ms when the room closes for everyone (start + 3 h). */
  endsAt: number;
  /** Looked up in the participant's own `retroFormats`: no peer colours or icons. */
  formatId: string;
  /** The board's columns in order, with their labels (for a format the participant doesn't have). */
  columns: RoomColumn[];
  phase: BoardPhase;
  timer: RoomTimer;
  /** The host's "Hide cards while writing" setting. */
  hideWhileWriting: boolean;
  /** Every card, or none while cards are hidden (`cardsHidden`). */
  cards: RoomCard[];
  /** While cards are hidden: how many cards each column holds. Empty otherwise. */
  counts: Record<string, number>;
  /** The members the host admits, in the order it seated them. */
  members: RoomMember[];
  /** Votes each admitted member has spent through the room. */
  votesUsed: Record<string, number>;
  /** Votes each person has. */
  votesPerPerson: number;
}

/** Whether a snapshot hides the cards: Write, with the host's hiding on. */
export function cardsHidden(s: Pick<RoomSnapshot, "hideWhileWriting" | "phase">): boolean {
  return s.hideWhileWriting && s.phase === "write";
}

// The kick and end messages (and their readers) are shared by every visitor room.
export {
  readEndMessage,
  readKickMessage,
  type EndMessage,
  type KickMessage,
} from "@/lib/realtime/room-control";

// ── Readers (shape only) ─────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const isShortStr = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

const IID_RE = /^[A-Za-z0-9_-]{1,32}$/;
/** A key: random, 16 to 64 URL-safe characters (the room makes nanoid(21)). */
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** A lock: a SHA-256 in unpadded base64url. */
const LOCK_RE = /^[A-Za-z0-9_-]{43}$/;

/** The lock for `key`: what a card or vote carries so only the key's holder can undo it. */
export function lockOf(key: string): string {
  return sha256Base64Url(key);
}

/** Whether `v` is shaped like a key. */
export function isKey(v: unknown): v is string {
  return typeof v === "string" && KEY_RE.test(v);
}

/** Whether `v` is shaped like a lock. */
export function isLock(v: unknown): v is string {
  return typeof v === "string" && LOCK_RE.test(v);
}

/**
 * Whether `v` is shaped like an intent id (and so like the id of a card
 * added through the room). Never `__proto__`: it becomes a card id, and the
 * ledger keys records by card id.
 */
export function isIntentId(v: unknown): v is string {
  return typeof v === "string" && IID_RE.test(v) && v !== "__proto__";
}

/**
 * The member id of a peer whose message is of another protocol version (a
 * tab on an older or newer build), or null. Only the version and sender are
 * read: nothing else in such a message is looked at.
 */
export function otherVersionSender(raw: unknown): string | null {
  const m = obj(raw);
  if (!m || typeof m.v !== "number" || m.v === RETRO_ROOM_PROTOCOL_VERSION) return null;
  return isVisitorMemberId(m.by) ? m.by : null;
}

/** A well-formed intent envelope, or null. Text is still raw: the reducer cleans it. */
export function readIntentEnv(raw: unknown): IntentEnv | null {
  const env = obj(raw);
  if (!env || env.v !== RETRO_ROOM_PROTOCOL_VERSION || !isVisitorMemberId(env.by)) return null;
  const by = env.by;
  const v = RETRO_ROOM_PROTOCOL_VERSION;
  const i = obj(env.intent);
  if (!i || !isIntentId(i.iid)) return null;
  const iid = i.iid;
  switch (i.t) {
    case "card:add":
      // Its id becomes the card's: never one the host's board reads as an example card's.
      if (isExampleId(iid)) return null;
      if (!isShortStr(i.columnKey, MAX_KEY_CHARS)) return null;
      if (typeof i.text !== "string" || i.text.length > MAX_RAW_TEXT_CHARS) return null;
      if (!isLock(i.lock)) return null;
      return {
        v,
        by,
        intent: { t: "card:add", iid, columnKey: i.columnKey, text: i.text, lock: i.lock },
      };
    case "card:delete":
      // Only cards added through the room can be deleted this way, and their ids are intent ids.
      if (!isIntentId(i.cardId) || !isKey(i.key)) return null;
      return { v, by, intent: { t: "card:delete", iid, cardId: i.cardId, key: i.key } };
    case "vote":
      if (!isShortStr(i.cardId, MAX_KEY_CHARS) || !isLock(i.lock)) return null;
      return { v, by, intent: { t: "vote", iid, cardId: i.cardId, lock: i.lock } };
    case "vote:undo":
      if (!isShortStr(i.cardId, MAX_KEY_CHARS) || !isKey(i.key)) return null;
      return { v, by, intent: { t: "vote:undo", iid, cardId: i.cardId, key: i.key } };
    default:
      return null;
  }
}
