/**
 * Retro visitor room: what the host shares and how participants read it.
 *
 * `toRoomSnapshot` (host side) copies only the fields the room needs. Hand-off
 * links (`sentTo`, which point into the host's other tools), carry-over ids,
 * per-name facilitator votes (`votesBy`), the host's own "Me" budget
 * (`userVotes`), the previous retro's id, and who added or voted on which
 * card never leave the host's device.
 *
 * While cards are hidden (Write, with "Hide cards while writing" on) the
 * snapshot carries no card at all, only how many each column holds and the
 * cards' ids, sorted (no text, column or author): each tab shows its own
 * cards from memory and checks their ids, and every card's text goes out
 * with the first snapshot after the phase changes.
 *
 * `readRoomSnapshot` (participant side) treats the payload as hostile: size
 * cap, strict shape, cards through `readRetro` plus the room's caps, no
 * control or bidi characters anywhere it renders. Whether the sender is the
 * trusted host is the hook's call (`use-retro-room.ts`).
 *
 * The format travels as an id plus its column keys and labels, and the
 * board's "Votes each" as `votesPerPerson`. Participants look the id up in
 * their own `retroFormats`, so no peer-supplied colour or icon reaches an
 * inline style; an id they don't know (a custom format among them) falls
 * back to the host's column labels in the local palette, which is the one
 * a custom format's columns are coloured from, in the same order.
 *
 * Pure apart from importing the snapshot validator.
 */

import {
  RETRO_COLUMN_PALETTE,
  retroFormats,
  type RetroFormat,
} from "@/lib/constants/retro-formats";
import { retroVotes } from "@/lib/retro/board";
import { readRetro } from "@/lib/share/snapshot-import";
import { cleanName, cleanText, isWithinJsonSize, shareableText } from "@/lib/realtime/sanitize";
import { VISITOR_LIMITS, isVisitorMemberId } from "@/lib/realtime/visitor-rooms";
import { PHASES, type BoardPhase, type BoardState, type RetroCard } from "../types";
import {
  BOARD_CARD_CAP,
  MAX_COLUMN_LABEL_CHARS,
  MAX_COLUMNS,
  MAX_FORMAT_NAME_CHARS,
  MAX_KEY_CHARS,
  MAX_VOTES_PER_PERSON,
  RETRO_ROOM_PROTOCOL_VERSION,
  cardsHidden,
  type RoomCard,
  type RoomColumn,
  type RoomMember,
  type RoomSnapshot,
} from "./protocol";

/** Longest timer a snapshot may carry (a day). */
const MAX_TIMER_SECONDS = 24 * 60 * 60;
/** Assignee names, as `readRetro` caps them. */
const MAX_ASSIGNEE_CHARS = 200;

/** The format id participants get when the host's isn't one of theirs. */
export const FALLBACK_FORMAT_ID = "room";
/** Local palette for fallback columns: the one custom formats use, in order. */
const FALLBACK_COLORS = RETRO_COLUMN_PALETTE;

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
  /** The host's "Hide cards while writing" setting. */
  hideWhileWriting: boolean;
  /** Votes each person has. */
  votesPerPerson: number;
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

/** The board's columns as the room shares them: key and label, cleaned, at most 12. */
function toRoomColumns(board: BoardState): RoomColumn[] {
  const columns: RoomColumn[] = [];
  const keys = new Set<string>();
  for (const c of board.format.columns) {
    if (columns.length >= MAX_COLUMNS) break;
    if (c.key.length === 0 || c.key.length > MAX_KEY_CHARS || keys.has(c.key)) continue;
    if (cleanText(c.key, MAX_KEY_CHARS) !== c.key) continue;
    keys.add(c.key);
    columns.push({ key: c.key, label: shareableText(c.label, MAX_COLUMN_LABEL_CHARS) || c.key });
  }
  return columns;
}

/**
 * The room's view of the host's board. Builds every card field by field, so
 * private fields (`sentTo`, `carriedFrom`) and board fields (`votesBy`,
 * `userVotes`, `previousRetroId`) can't ride along. While cards are hidden
 * it sends each column's count instead of the cards.
 */
export function toRoomSnapshot(board: BoardState, meta: SnapshotMeta): RoomSnapshot {
  const budget = Math.max(1, Math.min(MAX_VOTES_PER_PERSON, Math.round(meta.votesPerPerson) || 1));
  const columns = toRoomColumns(board);
  const formatName = shareableText(board.format.name ?? "", MAX_FORMAT_NAME_CHARS);
  const hidden = cardsHidden({ hideWhileWriting: meta.hideWhileWriting, phase: board.phase });
  const cards: RoomCard[] = [];
  for (const c of board.cards) {
    const rc = toRoomCard(c);
    if (rc) cards.push(rc);
  }
  const counts: Record<string, number> = {};
  const ids: string[] = [];
  if (hidden) {
    for (const col of columns) counts[col.key] = 0;
    for (const c of cards) {
      if (!Object.prototype.hasOwnProperty.call(counts, c.columnKey)) continue;
      counts[c.columnKey] += 1;
      ids.push(c.id);
    }
    // Sorted, so the order says nothing about who added what when.
    ids.sort();
  }
  const members = meta.members
    .slice(0, VISITOR_LIMITS.maxMembers)
    .map(({ id, name }) => ({ id, name }));
  const votesUsed: Record<string, number> = {};
  for (const m of members) {
    const n = Object.prototype.hasOwnProperty.call(meta.votesUsed, m.id) ? meta.votesUsed[m.id] : 0;
    if (Number.isInteger(n) && n > 0) votesUsed[m.id] = Math.min(n, budget);
  }
  return {
    v: RETRO_ROOM_PROTOCOL_VERSION,
    by: meta.by,
    seq: meta.seq,
    hostId: meta.by,
    endsAt: meta.endsAt,
    formatId: board.format.id,
    ...(formatName ? { formatName } : {}),
    columns,
    phase: board.phase,
    timer: {
      running: meta.timer.running,
      remaining: Math.max(0, Math.min(MAX_TIMER_SECONDS, Math.round(meta.timer.remaining) || 0)),
      at: meta.now,
    },
    hideWhileWriting: meta.hideWhileWriting,
    cards: hidden ? [] : cards,
    counts,
    ids,
    members,
    votesUsed,
    votesPerPerson: budget,
  };
}

/**
 * What a snapshot depends on, as a string: a change means "send one". The
 * timer counts only by its running flag while it runs, so the 1 s tick never
 * triggers a broadcast; starting, pausing, resetting or a preset does, and
 * so does switching "Hide cards while writing" or "Votes each".
 */
export function roomSignature(board: BoardState, hideWhileWriting = false): string {
  return JSON.stringify([
    board.format.id,
    board.format.name,
    board.format.columns.map((c) => [c.key, c.label]),
    board.phase,
    hideWhileWriting,
    retroVotes(board),
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

function readColumns(raw: unknown): RoomColumn[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_COLUMNS) return null;
  const columns: RoomColumn[] = [];
  const keys = new Set<string>();
  for (const rc of raw) {
    const c = obj(rc);
    if (!c || typeof c.key !== "string" || typeof c.label !== "string") return null;
    if (!isCleanText(c.key, MAX_KEY_CHARS) || keys.has(c.key)) return null;
    if (!isCleanText(c.label, MAX_COLUMN_LABEL_CHARS)) return null;
    keys.add(c.key);
    columns.push({ key: c.key, label: c.label });
  }
  return columns;
}

/** Per-column counts: only known columns, whole numbers, 200 cards at most in all. */
function readCounts(raw: unknown, columns: readonly RoomColumn[]): Record<string, number> | null {
  const o = obj(raw);
  if (!o) return null;
  const keys = new Set(columns.map((c) => c.key));
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [key, n] of Object.entries(o)) {
    if (!keys.has(key)) return null;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > BOARD_CARD_CAP) return null;
    total += n;
    counts[key] = n;
  }
  return total > BOARD_CARD_CAP ? null : counts;
}

/** Hidden cards' ids: unique, clean, at most 200, as many as the counts add up to. */
function readIds(raw: unknown, total: number): string[] | null {
  if (!Array.isArray(raw) || raw.length !== total || raw.length > BOARD_CARD_CAP) return null;
  const ids = new Set<string>();
  for (const id of raw) {
    if (typeof id !== "string" || id.length === 0 || !isCleanText(id, MAX_KEY_CHARS)) return null;
    if (ids.has(id)) return null;
    ids.add(id);
  }
  return Array.from(ids);
}

/**
 * A validated snapshot, rebuilt from known fields only, or null. Rejects:
 * over `VISITOR_LIMITS.maxPayloadChars`; a wrong version; a sender that isn't
 * the host it names; more than 200 cards, 12 columns or 20 members; any card
 * `readRetro` refuses, with a duplicate id, or with text, column key or
 * assignee holding control or bidi characters; a column, member or format
 * with an unclean label or name; cards while they should be hidden, or counts and
 * ids while they shouldn't; ids that don't match the counts; votes outside
 * the budget it states.
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
  const formatName = s.formatName;
  if (formatName !== undefined) {
    if (typeof formatName !== "string" || !isCleanText(formatName, MAX_FORMAT_NAME_CHARS)) {
      return null;
    }
  }
  if (!isPhase(s.phase)) return null;
  if (typeof s.hideWhileWriting !== "boolean") return null;
  const budget = s.votesPerPerson;
  if (typeof budget !== "number" || !Number.isInteger(budget)) return null;
  if (budget < 1 || budget > MAX_VOTES_PER_PERSON) return null;
  const columns = readColumns(s.columns);
  if (!columns) return null;

  const t = obj(s.timer);
  if (!t || typeof t.running !== "boolean") return null;
  if (typeof t.remaining !== "number" || !Number.isFinite(t.remaining)) return null;
  if (t.remaining < 0 || t.remaining > MAX_TIMER_SECONDS) return null;
  if (typeof t.at !== "number" || !Number.isFinite(t.at)) return null;

  if (!Array.isArray(s.cards) || s.cards.length > BOARD_CARD_CAP) return null;
  const counts = readCounts(s.counts, columns);
  if (!counts) return null;
  const hidden = cardsHidden({ hideWhileWriting: s.hideWhileWriting, phase: s.phase });
  if (hidden ? s.cards.length > 0 : Object.keys(counts).length > 0) return null;
  let total = 0;
  for (const n of Object.values(counts)) total += n;
  const hiddenIds = readIds(s.ids, total);
  if (!hiddenIds) return null;
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
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > budget) return null;
    votesUsed[id] = n;
  }

  return {
    v: RETRO_ROOM_PROTOCOL_VERSION,
    by: s.by,
    seq: s.seq,
    hostId: s.by,
    endsAt: s.endsAt,
    formatId: s.formatId,
    ...(formatName !== undefined ? { formatName } : {}),
    columns,
    phase: s.phase,
    timer: { running: t.running, remaining: Math.floor(t.remaining), at: t.at },
    hideWhileWriting: s.hideWhileWriting,
    cards,
    counts,
    ids: hiddenIds,
    members,
    votesUsed,
    votesPerPerson: budget,
  };
}

/**
 * The format to render: the participant's own copy of `formatId`, or, when
 * the id is unknown (a custom format), the host's columns (keys and labels)
 * in the local palette under the host's format name. With no columns at
 * all, plain columns named after the cards' column keys, in order of first
 * use.
 */
export function resolveRoomFormat(
  formatId: string,
  columns: readonly RoomColumn[],
  cards: readonly RoomCard[] = [],
  formatName?: string
): RetroFormat {
  const known = retroFormats.find((f) => f.id === formatId);
  if (known) return known;
  const named: RoomColumn[] = columns.slice(0, MAX_COLUMNS).map((c) => ({ ...c }));
  if (named.length === 0) {
    for (const c of cards) {
      if (!named.some((n) => n.key === c.columnKey))
        named.push({ key: c.columnKey, label: c.columnKey });
      if (named.length >= MAX_COLUMNS) break;
    }
  }
  return {
    id: FALLBACK_FORMAT_ID,
    name: formatName || "Retro",
    description: "",
    columns: named.map(({ key, label }, i) => ({
      key,
      label,
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
 * While cards are hidden the board has none: the hook adds the tab's own.
 */
export function boardFromSnapshot(snap: RoomSnapshot): BoardState {
  const format = resolveRoomFormat(snap.formatId, snap.columns, snap.cards, snap.formatName);
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
