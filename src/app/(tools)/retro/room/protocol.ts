/**
 * Retro visitor room: the wire protocol.
 *
 * The room is host-authoritative. The person who pressed "Everyone on their
 * own device" owns the board; everyone else sends intents and renders the
 * host's snapshots.
 *
 *   participant → host   "retro:intent"  IntentEnv   (add a card, cast a vote)
 *   host → everyone      "retro:state"   RoomSnapshot (throttled 500 ms, on
 *                                        member join, 30 s keepalive)
 *   host → everyone      "retro:kick"    KickMessage  (soft removal)
 *   host → everyone      "retro:end"     EndMessage
 *
 * Every inbound message is untrusted: `by` is self-declared, so these readers
 * check shape and size only. Who may send what is decided by the reducer
 * (`intents.ts`) and the hook (`use-retro-room.ts`).
 *
 * Pure, no browser globals.
 */

import { VISITOR_LIMITS, isVisitorMemberId } from "@/lib/realtime/visitor-rooms";
import type { BoardPhase, RetroCard } from "../types";

export const RETRO_ROOM_EVENTS = {
  intent: "retro:intent",
  state: "retro:state",
  kick: "retro:kick",
  end: "retro:end",
} as const;

export const RETRO_ROOM_PROTOCOL_VERSION = 1 as const;

// ── Limits ───────────────────────────────────────────────────────────

/** Cards one member may add through the room. */
export const MEMBER_CARD_CAP = 30;
/** Cards on the board, host's own included, before the room stops taking more. */
export const BOARD_CARD_CAP = 200;
/** How many recent intent ids the host remembers to drop duplicates. */
export const INTENT_ID_RING = 256;
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

// ── Messages ─────────────────────────────────────────────────────────

export type RetroIntent =
  | { t: "card:add"; iid: string; columnKey: string; text: string }
  | { t: "vote"; iid: string; cardId: string };

export interface IntentEnv {
  v: 1;
  by: string;
  intent: RetroIntent;
}

/** A card as the room shares it: no hand-off links, no carry-over ids. */
export type RoomCard = Pick<
  RetroCard,
  "id" | "columnKey" | "text" | "votes" | "groupedWith" | "isActionItem" | "assignee" | "discussing"
>;

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
  v: 1;
  by: string;
  seq: number;
  hostId: string;
  /** Epoch ms when the room closes for everyone (start + 3 h). */
  endsAt: number;
  /** Looked up in the participant's own `retroFormats`: no peer colours or icons. */
  formatId: string;
  phase: BoardPhase;
  timer: RoomTimer;
  cards: RoomCard[];
  /** The members the host admits, in the order it seated them. */
  members: RoomMember[];
  /** Votes each admitted member has spent through the room. */
  votesUsed: Record<string, number>;
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

/** A well-formed intent envelope, or null. Text is still raw: the reducer cleans it. */
export function readIntentEnv(raw: unknown): IntentEnv | null {
  const env = obj(raw);
  if (!env || env.v !== RETRO_ROOM_PROTOCOL_VERSION || !isVisitorMemberId(env.by)) return null;
  const i = obj(env.intent);
  if (!i || typeof i.iid !== "string" || !IID_RE.test(i.iid)) return null;
  if (i.t === "card:add") {
    if (!isShortStr(i.columnKey, MAX_KEY_CHARS)) return null;
    if (typeof i.text !== "string" || i.text.length > MAX_RAW_TEXT_CHARS) return null;
    return {
      v: 1,
      by: env.by,
      intent: { t: "card:add", iid: i.iid, columnKey: i.columnKey, text: i.text },
    };
  }
  if (i.t === "vote") {
    if (!isShortStr(i.cardId, MAX_KEY_CHARS)) return null;
    return { v: 1, by: env.by, intent: { t: "vote", iid: i.iid, cardId: i.cardId } };
  }
  return null;
}
