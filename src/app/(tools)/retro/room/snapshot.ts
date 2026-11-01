/**
 * Retro visitor room: what the host shares and how participants read it.
 *
 * `toRoomSnapshot` (host side) copies only the fields the room needs. Hand-off
 * links (`sentTo`, which point into the host's other tools), carry-over ids,
 * per-name facilitator votes (`votesBy`), the host's own "Me" budget
 * (`userVotes`) and the previous retro's id never leave the host's device.
 *
 * `readRoomSnapshot` (participant side) treats the payload as hostile: size
 * cap, strict shape, cards through `readRetro` plus the room's caps, no
 * control or bidi characters anywhere it renders. Whether the sender is the
 * trusted host is the hook's call (`use-retro-room.ts`).
 *
 * The format travels as an id only. Participants look it up in their own
 * `retroFormats`, so no peer-supplied colour or icon reaches an inline style;
 * an id they don't know falls back to plain columns named after the cards'
 * column keys, in local colours.
 *
 * Pure apart from importing the snapshot validator.
 */

import { retroFormats, type RetroFormat } from "@/lib/constants/retro-formats";
import { readRetro } from "@/lib/share/snapshot-import";
import { cleanName, cleanText, isWithinJsonSize, shareableText } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS, isVisitorMemberId } from "@/lib/realtime/visitor-rooms";
import { MAX_VOTES, PHASES, type BoardPhase, type BoardState, type RetroCard } from "../types";
import {
  BOARD_CARD_CAP,
  MAX_KEY_CHARS,
  RETRO_ROOM_PROTOCOL_VERSION,
  type RoomCard,
  type RoomMember,
  type RoomSnapshot,
} from "./protocol";

/** Longest timer a snapshot may carry (a day). */
const MAX_TIMER_SECONDS = 24 * 60 * 60;
/** Assignee names, as `readRetro` caps them. */
const MAX_ASSIGNEE_CHARS = 200;
/** Columns in a fallback format, as `readRetro` caps formats. */
const MAX_FALLBACK_COLUMNS = 12;

/** The format id participants get when the host's isn't one of theirs. */
export const FALLBACK_FORMAT_ID = "room";
/** Local palette for fallback columns (all brand colours `themed()` maps). */
const FALLBACK_COLORS = ["#00f0ff", "#00ff88", "#f59e0b", "#a855f7", "#ef4444"];

// ── Host side ────────────────────────────────────────────────────────

export interface SnapshotMeta {
  /** The host's member id. */
  by: string;
  seq: number;
  endsAt: number;
  /** The members the host admits. */
  members: readonly RoomMember[];
  /** Votes spent through the room, by member id. */
  votesUsed: Readonly<Record<string, number>>;
  /** The timer now: seconds left and whether it's counting down. */
  timer: { running: boolean; remaining: number };
  /** Host clock, epoch ms. */
  now: number;
}

function toRoomCard(c: RetroCard): RoomCard | null {
  if (c.id.length > MAX_KEY_CHARS || c.columnKey.length > MAX_KEY_CHARS) return null;
  const text = shareableText(c.text, VISITOR_LIMITS.maxTextChars);
  if (!text) return null;
  return {
    id: c.id,
    columnKey: c.columnKey,
    text,
    votes: Math.max(0, Math.min(999, Math.round(c.votes) || 0)),
    groupedWith:
      typeof c.groupedWith === "string" && c.groupedWith.length <= MAX_KEY_CHARS
        ? c.groupedWith
        : null,
    isActionItem: c.isActionItem === true,
    assignee: shareableText(c.assignee ?? "", MAX_ASSIGNEE_CHARS),
    discussing: c.discussing === true,
  };
}

/**
 * The room's view of the host's board. Builds every card field by field, so
 * private fields (`sentTo`, `carriedFrom`) and board fields (`votesBy`,
 * `userVotes`, `previousRetroId`) can't ride along.
 */
export function toRoomSnapshot(board: BoardState, meta: SnapshotMeta): RoomSnapshot {
  const cards: RoomCard[] = [];
  for (const c of board.cards) {
    const rc = toRoomCard(c);
    if (rc) cards.push(rc);
  }
  const members = meta.members
    .slice(0, VISITOR_LIMITS.maxMembers)
    .map(({ id, name }) => ({ id, name }));
  const votesUsed: Record<string, number> = {};
  for (const m of members) {
    const n = Object.prototype.hasOwnProperty.call(meta.votesUsed, m.id) ? meta.votesUsed[m.id] : 0;
    if (Number.isInteger(n) && n > 0) votesUsed[m.id] = Math.min(n, MAX_VOTES);
  }
  return {
    v: RETRO_ROOM_PROTOCOL_VERSION,
    by: meta.by,
    seq: meta.seq,
    hostId: meta.by,
    endsAt: meta.endsAt,
    formatId: board.format.id,
    phase: board.phase,
    timer: {
      running: meta.timer.running,
      remaining: Math.max(0, Math.min(MAX_TIMER_SECONDS, Math.round(meta.timer.remaining) || 0)),
      at: meta.now,
    },
    cards,
    members,
    votesUsed,
  };
}

/**
 * What a snapshot depends on, as a string: a change means "send one". The
 * timer counts only by its running flag while it runs, so the 1 s tick never
 * triggers a broadcast; starting, pausing, resetting or a preset does.
 */
export function roomSignature(board: BoardState): string {
  return JSON.stringify([
    board.format.id,
    board.phase,
    board.timerRunning,
    board.timerRunning ? -1 : board.timerSeconds,
    board.cards.map((c) => [
      c.id,
      c.columnKey,
      c.text,
      c.votes,
      c.groupedWith,
      c.isActionItem,
      c.assignee,
      c.discussing,
    ]),
  ]);
}

// ── Participant side ─────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const PHASE_KEYS = new Set<string>(PHASES.map((p) => p.key));

function isPhase(v: unknown): v is BoardPhase {
  return typeof v === "string" && PHASE_KEYS.has(v);
}

/** Text a participant will render: exactly what `cleanText` would make of it. */
function isCleanText(v: string, max: number): boolean {
  return cleanText(v, max) === v;
}

/**
 * A validated snapshot, rebuilt from known fields only, or null. Rejects:
 * over `VISITOR_LIMITS.maxPayloadChars`; a wrong version; a sender that isn't
 * the host it names; more than 200 cards or 20 members; any card `readRetro`
 * refuses, with a duplicate id, or with text, column key or assignee holding
 * control or bidi characters; a member with an unclean name.
 */
export function readRoomSnapshot(raw: unknown): RoomSnapshot | null {
  if (!isWithinJsonSize(raw, VISITOR_LIMITS.maxPayloadChars)) return null;
  const s = obj(raw);
  if (!s || s.v !== RETRO_ROOM_PROTOCOL_VERSION) return null;
  if (!isVisitorMemberId(s.by) || s.hostId !== s.by) return null;
  if (typeof s.seq !== "number" || !Number.isSafeInteger(s.seq) || s.seq < 0) return null;
  if (typeof s.endsAt !== "number" || !Number.isFinite(s.endsAt) || s.endsAt <= 0) return null;
  if (typeof s.formatId !== "string" || s.formatId.length === 0) return null;
  if (s.formatId.length > MAX_KEY_CHARS) return null;
  if (!isPhase(s.phase)) return null;

  const t = obj(s.timer);
  if (!t || typeof t.running !== "boolean") return null;
  if (typeof t.remaining !== "number" || !Number.isFinite(t.remaining)) return null;
  if (t.remaining < 0 || t.remaining > MAX_TIMER_SECONDS) return null;
  if (typeof t.at !== "number" || !Number.isFinite(t.at)) return null;

  if (!Array.isArray(s.cards) || s.cards.length > BOARD_CARD_CAP) return null;
  // Structure and per-field caps: the same validator as shared snapshot links.
  const checked = readRetro({ format: { name: "Room", columns: [] }, cards: s.cards });
  if (!checked) return null;
  const ids = new Set<string>();
  const cards: RoomCard[] = [];
  for (let i = 0; i < checked.cards.length; i++) {
    const c = checked.cards[i];
    if (ids.has(c.id)) return null;
    ids.add(c.id);
    if (!isCleanText(c.columnKey, MAX_KEY_CHARS) || !isCleanText(c.id, MAX_KEY_CHARS)) return null;
    if (!isCleanText(c.text, VISITOR_LIMITS.maxTextChars)) return null;
    if (c.assignee !== "" && !isCleanText(c.assignee, MAX_ASSIGNEE_CHARS)) return null;
    const rawCard = obj(s.cards[i]);
    cards.push({
      id: c.id,
      columnKey: c.columnKey,
      text: c.text,
      votes: c.votes,
      groupedWith: c.groupedWith,
      isActionItem: c.isActionItem,
      assignee: c.assignee,
      // `readRetro` resets it (shared links never arrive mid-discussion); the room keeps it.
      discussing: rawCard?.discussing === true,
    });
  }

  if (!Array.isArray(s.members) || s.members.length > VISITOR_LIMITS.maxMembers) return null;
  const members: RoomMember[] = [];
  const memberIds = new Set<string>();
  for (const rm of s.members) {
    const m = obj(rm);
    if (!m || !isVisitorMemberId(m.id) || memberIds.has(m.id)) return null;
    if (typeof m.name !== "string" || cleanName(m.name) !== m.name) return null;
    memberIds.add(m.id);
    members.push({ id: m.id, name: m.name });
  }

  const rawVotes = obj(s.votesUsed);
  if (!rawVotes) return null;
  const votesUsed: Record<string, number> = {};
  const voteEntries = Object.entries(rawVotes);
  if (voteEntries.length > VISITOR_LIMITS.maxMembers) return null;
  for (const [id, n] of voteEntries) {
    if (!isVisitorMemberId(id)) return null;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_VOTES) return null;
    votesUsed[id] = n;
  }

  return {
    v: RETRO_ROOM_PROTOCOL_VERSION,
    by: s.by,
    seq: s.seq,
    hostId: s.by,
    endsAt: s.endsAt,
    formatId: s.formatId,
    phase: s.phase,
    timer: { running: t.running, remaining: Math.floor(t.remaining), at: t.at },
    cards,
    members,
    votesUsed,
  };
}

/**
 * The format to render: the participant's own copy of `formatId`, or plain
 * columns named after the cards' column keys (in order of first use) in the
 * local palette when the id is unknown.
 */
export function resolveRoomFormat(formatId: string, cards: readonly RoomCard[]): RetroFormat {
  const known = retroFormats.find((f) => f.id === formatId);
  if (known) return known;
  const keys: string[] = [];
  for (const c of cards) {
    if (!keys.includes(c.columnKey)) keys.push(c.columnKey);
    if (keys.length >= MAX_FALLBACK_COLUMNS) break;
  }
  return {
    id: FALLBACK_FORMAT_ID,
    name: "Retro",
    description: "",
    columns: keys.map((key, i) => ({
      key,
      label: key,
      color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      icon: "",
    })),
  };
}

/**
 * Keep grouping one level deep and inside a column: a card may sit under a
 * top-level card in its own column, otherwise it stands alone. Stops a
 * crafted snapshot from hiding cards behind cycles or missing parents.
 */
function flattenGroups(cards: RetroCard[]): RetroCard[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return cards.map((c) => {
    if (c.groupedWith === null) return c;
    const parent = byId.get(c.groupedWith);
    const ok =
      parent !== undefined &&
      parent.id !== c.id &&
      parent.groupedWith === null &&
      parent.columnKey === c.columnKey;
    return ok ? c : { ...c, groupedWith: null };
  });
}

/**
 * An in-memory board for a participant (never stored). Cards outside the
 * resolved format's columns are dropped. Timer fields are as of receipt.
 */
export function boardFromSnapshot(snap: RoomSnapshot): BoardState {
  const format = resolveRoomFormat(snap.formatId, snap.cards);
  const columns = new Set(format.columns.map((c) => c.key));
  const cards = flattenGroups(
    snap.cards.filter((c) => columns.has(c.columnKey)).map((c) => ({ ...c }))
  );
  return {
    format,
    phase: snap.phase,
    cards,
    userVotes: 0,
    timerSeconds: snap.timer.remaining,
    timerRunning: snap.timer.running,
    discussingIndex: 0,
  };
}
