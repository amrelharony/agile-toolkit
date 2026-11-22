/**
 * Blocked spells: when a story or a Kanban card was flagged as blocked and
 * when the flag came off, written on every write the way a status change
 * stamps `startedAt` and `doneAt`. The workspace store's story and board
 * writes, the agents' `workspace.story` and `workspace.kanban_board` CRUDs
 * and the tools that call `stampStoryWrite` (lib/sprints/story-status) all
 * stamp through here, so a blocked spell is recorded the same way wherever
 * the flag changes. Synced and imported rows keep their own logs.
 *
 * The rules, for `next` (the row about to be saved) against `prev` (the
 * stored one, undefined for a new row):
 *   - example rows are never stamped;
 *   - a write that set its own log (an Undo putting a copy back, a block
 *     note, an agent's backfill) is kept as written: its `blockLog` differs
 *     by value from the stored row's (whatever order a spell's keys are in:
 *     jsonb, zod and the cleaners each write their own), or, on a new row,
 *     it has one at all;
 *   - the flag going on appends `{from: at}`;
 *   - the flag going off (a move into Done drops it too) closes the open
 *     spell, the last one without `to`. With no open spell nothing is
 *     written: the block began before tracking;
 *   - a new row created blocked gets `[{from: at}]`, the write time;
 *   - only the latest `BLOCK_LOG_CAP` spells are kept;
 *   - nothing to stamp: `next` itself, by reference.
 *
 * A leaf, so lib/sprints/story-status can import it without a loop: types
 * and caps from the workspace types, `isExampleId`, and its own date maths.
 * Nothing from ./items, ./cycle, ./stages or lib/kanban.
 */

import {
  BLOCK_SIDES,
  BLOCKER_CLUSTER_MAX,
  HANDOFF_ROUTE_IDS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  WORK_DEMANDS,
  WORK_TYPES,
} from "@/lib/stores/workspace-types";
import type {
  BlockSide,
  BlockSpell,
  HandoffLink,
  KanbanBoard,
  KanbanCard,
  Story,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";

/** At most this many blocked spells are kept per story or card (the latest). */
export const BLOCK_LOG_CAP = TOOL_LIST_MAX.blockLog;

/**
 * The local day blocked time starts counting ("YYYY-MM-DD"). Spells exist
 * only from here on, so readers leave items started before it out of their
 * blocked-time numbers.
 */
// TODO(phase PR): the day Phase 2 reaches master.
export const BLOCK_TRACKING_SINCE = "2026-11-22";

/** A row that can be flagged as blocked: a story or a Kanban card. */
export interface BlockableRow {
  id: string;
  blocked?: boolean;
  blockLog?: BlockSpell[];
}

/* ── Date maths ──────────────────────────────────────────────────────── */

/** A stamp's moment in ms; a plain "YYYY-MM-DD" is local midnight. Null when it isn't a time. */
function momentMs(at: unknown): number | null {
  if (typeof at !== "string") return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at);
  if (plain) {
    const t = new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])).getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : null;
}

/* ── Stamps ──────────────────────────────────────────────────────────── */

/** A spell's fields, in the order `canonSpell` lists them. */
const SPELL_KEYS = ["from", "to", "cause", "cluster", "side", "earlier", "sentTo"] as const;

/**
 * A spell's fields as a list in a fixed order, and its links' fields too, so
 * two equal spells compare equal whatever order their keys were written in.
 * Postgres jsonb reads keys back shortest first (`{"to", "from"}`), zod
 * writes them in schema order, and closing a spell appends `to` after the
 * note. Unknown keys don't count; anything that isn't a spell is left as it is.
 */
function canonSpell(spell: unknown): unknown {
  if (!spell || typeof spell !== "object" || Array.isArray(spell)) return spell;
  const raw = spell as Record<string, unknown>;
  return SPELL_KEYS.map((key) => {
    const value = raw[key];
    if (key !== "sentTo" || !Array.isArray(value)) return value;
    return value.map((link: unknown) => {
      if (!link || typeof link !== "object" || Array.isArray(link)) return link;
      const { route, targetId, at } = link as Record<string, unknown>;
      return [route, targetId, at];
    });
  });
}

/** Two spells equal by value, whatever order their keys are in. */
function sameSpell(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(canonSpell(a)) === JSON.stringify(canonSpell(b));
}

/** Equal by value, whatever order the keys are in: no log and an empty one are the same. */
function sameLog(a: unknown, b: unknown): boolean {
  const x = Array.isArray(a) && a.length === 0 ? undefined : a;
  const y = Array.isArray(b) && b.length === 0 ? undefined : b;
  if (x === y) return true;
  if (!Array.isArray(x) || !Array.isArray(y)) return JSON.stringify(x) === JSON.stringify(y);
  return x.length === y.length && x.every((spell, i) => sameSpell(spell, y[i]));
}

/**
 * The index of the open spell, the last one without `to`; -1 when there is
 * none. Only the last such spell is open: an earlier one without an end
 * (left by a write that skipped the stamps) is not still running.
 */
export function openSpellIndex(log: readonly BlockSpell[] | null | undefined): number {
  if (!Array.isArray(log)) return -1;
  for (let i = log.length - 1; i >= 0; i--) {
    const spell: unknown = log[i];
    if (spell && typeof spell === "object" && (spell as BlockSpell).to === undefined) return i;
  }
  return -1;
}

/** `row` with `log` as its blocked spells (the latest `BLOCK_LOG_CAP`). */
function withLog<T extends BlockableRow>(row: T, log: BlockSpell[]): T {
  return { ...row, blockLog: log.slice(-BLOCK_LOG_CAP) };
}

/** `row` with its log cut to the cap, or `row` itself when it fits. */
function capped<T extends BlockableRow>(row: T): T {
  return Array.isArray(row.blockLog) && row.blockLog.length > BLOCK_LOG_CAP
    ? withLog(row, row.blockLog)
    : row;
}

/** The end to write on `spell` at `at`: never before its start. */
function endAt(spell: BlockSpell, at: string): string {
  const from = momentMs(spell.from);
  const to = momentMs(at);
  return from !== null && to !== null && to < from ? spell.from : at;
}

/** The stamping rules for one row (see the module doc). */
function stampRow<T extends BlockableRow>(next: T, prev: T | undefined, at: string): T {
  if (isExampleId(next.id)) return next;
  const on = Boolean(next.blocked);
  if (!prev) {
    // A new row: any log it brings was set by the write.
    if (next.blockLog !== undefined) return capped(next);
    return on ? withLog(next, [{ from: at }]) : next;
  }
  if (!sameLog(next.blockLog, prev.blockLog)) return capped(next);
  const was = Boolean(prev.blocked);
  if (on === was) return capped(next);
  const log = Array.isArray(next.blockLog) ? next.blockLog : [];
  if (on) return withLog(next, [...log, { from: at }]);
  const open = openSpellIndex(log);
  if (open < 0) return capped(next);
  const closed = log.slice();
  closed[open] = { ...log[open], to: endAt(log[open], at) };
  return withLog(next, closed);
}

/**
 * Blocked-spell stamps for any write of a story: `next` is the record about
 * to be saved and `prev` the stored one (undefined for a new story). The
 * same story (by reference) when there is nothing to stamp.
 */
export function stampStoryBlocks(
  next: Story,
  prev: Story | undefined,
  at: string = new Date().toISOString()
): Story {
  return stampRow(next, prev, at);
}

/**
 * Blocked-spell stamps for any write of the Kanban board, card by card (a
 * card is matched to the stored one by id; a card the stored board doesn't
 * have is new). The same board (by reference) when no card is stamped.
 */
export function stampBoardBlocks(
  next: KanbanBoard,
  prev: KanbanBoard | undefined,
  at: string = new Date().toISOString()
): KanbanBoard {
  if (!Array.isArray(next.cards)) return next;
  const stored = new Map<string, KanbanCard>();
  if (prev && Array.isArray(prev.cards)) {
    for (const card of prev.cards) {
      if (card && typeof card === "object" && typeof card.id === "string")
        stored.set(card.id, card);
    }
  }
  let changed = false;
  const cards = next.cards.map((card) => {
    if (!card || typeof card !== "object" || typeof card.id !== "string") return card;
    const out = stampRow(card, stored.get(card.id), at);
    if (out !== card) changed = true;
    return out;
  });
  return changed ? { ...next, cards } : next;
}

/* ── Cleaning what an agent or a sync wrote ─────────────────────────── */

/** `text` trimmed and cut to `max`, or undefined when there is none. */
function cleanText(text: unknown, max: number): string | undefined {
  if (typeof text !== "string") return undefined;
  const out = text.trim().slice(0, max).trim();
  return out === "" ? undefined : out;
}

function isBlockSide(value: unknown): value is BlockSide {
  return typeof value === "string" && (BLOCK_SIDES as readonly string[]).includes(value);
}

function isHandoffLink(value: unknown): value is HandoffLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Record<string, unknown>;
  return (
    typeof link.route === "string" &&
    (HANDOFF_ROUTE_IDS as readonly string[]).includes(link.route) &&
    typeof link.targetId === "string" &&
    link.targetId !== "" &&
    typeof link.at === "string"
  );
}

/** The valid hand-off links in `raw`, the first one per route; undefined when there are none. */
function cleanSentTo(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: HandoffLink[] = [];
  for (const link of raw) {
    if (!isHandoffLink(link) || seen.has(link.route)) continue;
    seen.add(link.route);
    out.push({ route: link.route, targetId: link.targetId, at: link.at });
  }
  return out.length ? out : undefined;
}

/** One stored spell as far as it can be read, or null when it has no start. */
function cleanSpell(raw: unknown): BlockSpell | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const spell = raw as Record<string, unknown>;
  const from = momentMs(spell.from);
  if (from === null) return null;
  const out: BlockSpell = { from: spell.from as string };
  const to = momentMs(spell.to);
  if (to !== null && to >= from) out.to = spell.to as string;
  const cause = cleanText(spell.cause, TOOL_TEXT_MAX.short);
  if (cause !== undefined) out.cause = cause;
  const cluster = cleanText(spell.cluster, BLOCKER_CLUSTER_MAX);
  if (cluster !== undefined) out.cluster = cluster;
  if (isBlockSide(spell.side)) out.side = spell.side;
  if (spell.earlier === true) out.earlier = true;
  const sentTo = cleanSentTo(spell.sentTo);
  if (sentTo) out.sentTo = sentTo;
  return out;
}

/**
 * A stored blocked log as far as it can be read, the way `cardHistory`
 * (lib/kanban/flow) reads a card's moves: anything that isn't a spell is
 * dropped, as is a spell without a start time; an end before the start is
 * removed; the cause is cut to "short" and the cluster to
 * `BLOCKER_CLUSTER_MAX`; a side that isn't one is dropped; only valid
 * hand-off links are kept, one per route; unknown keys go; the latest
 * `BLOCK_LOG_CAP` are kept. Undefined when no spell is left.
 */
export function cleanBlockLog(raw: unknown): BlockSpell[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map(cleanSpell).filter((s): s is BlockSpell => s !== null);
  return out.length ? out.slice(-BLOCK_LOG_CAP) : undefined;
}

/** The flow fields a story or a card carries. */
type FlowFields = Pick<KanbanCard, "blockLog" | "workType" | "demand">;

/**
 * A card (or a story) with its flow fields cleaned: `blockLog` through
 * `cleanBlockLog`, and `workType` and `demand` removed unless they are one
 * of `WORK_TYPES` and `WORK_DEMANDS`. The same row (by reference) when
 * nothing changes. The board CRUD runs it on every card an agent writes.
 */
export function cleanCardFlowFields<T extends FlowFields>(card: T): T {
  if (!card || typeof card !== "object") return card;
  const raw = card as Record<string, unknown>;
  const out: Record<string, unknown> = { ...raw };
  let changed = false;
  if ("blockLog" in raw) {
    const log = cleanBlockLog(raw.blockLog);
    if (log === undefined) delete out.blockLog;
    else out.blockLog = log;
    changed = !sameExact(raw.blockLog, log);
  }
  if ("workType" in raw && !(WORK_TYPES as readonly unknown[]).includes(raw.workType)) {
    delete out.workType;
    changed = true;
  }
  if ("demand" in raw && !(WORK_DEMANDS as readonly unknown[]).includes(raw.demand)) {
    delete out.demand;
    changed = true;
  }
  return changed ? (out as T) : card;
}

/** Equal by value, an empty log and none told apart (so an empty one is removed). */
function sameExact(a: unknown, b: unknown): boolean {
  return a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
}

/* ── Notes on a spell ───────────────────────────────────────────────── */

/**
 * What a person or an agent says about a blocked spell. `""` clears a text
 * field, `side: null` clears the side and `sentTo: []` the links; a field
 * left out is left as it is. `sentTo` replaces the spell's links (valid
 * ones only, one per route).
 */
export interface SpellNote {
  cause?: string;
  cluster?: string;
  side?: BlockSide | null;
  sentTo?: HandoffLink[];
}

/** `spell` with `note` written on it (the same spell when nothing changes). */
function notedSpell(spell: BlockSpell, note: SpellNote): BlockSpell {
  const out: BlockSpell = { ...spell };
  if (note.cause !== undefined) {
    const cause = cleanText(note.cause, TOOL_TEXT_MAX.short);
    if (cause === undefined) delete out.cause;
    else out.cause = cause;
  }
  if (note.cluster !== undefined) {
    const cluster = cleanText(note.cluster, BLOCKER_CLUSTER_MAX);
    if (cluster === undefined) delete out.cluster;
    else out.cluster = cluster;
  }
  if (note.side === null) delete out.side;
  else if (isBlockSide(note.side)) out.side = note.side;
  if (note.sentTo !== undefined) {
    const sentTo = cleanSentTo(note.sentTo);
    if (sentTo === undefined) delete out.sentTo;
    else out.sentTo = sentTo;
  }
  return sameSpell(out, spell) ? spell : out;
}

/**
 * `row` with `note` written on one of its blocked spells: the one starting
 * at `spellFrom`, or by default the open one. A row that is blocked with no
 * open spell (blocked since before tracking) gets a new one, `{from: at,
 * earlier: true}` with the note. Null when no spell matches. The same row
 * (by reference) when the note changes nothing. The new log differs from
 * the stored one, so the store keeps it as written.
 */
export function withSpellNote<T extends BlockableRow>(
  row: T,
  note: SpellNote,
  { spellFrom, at = new Date().toISOString() }: { spellFrom?: string; at?: string } = {}
): T | null {
  const log = Array.isArray(row.blockLog) ? row.blockLog : [];
  let index = -1;
  if (spellFrom !== undefined) {
    for (let i = log.length - 1; i >= 0 && index < 0; i--) {
      if (log[i]?.from === spellFrom) index = i;
    }
  } else {
    index = openSpellIndex(log);
  }
  if (index < 0) {
    if (spellFrom !== undefined || !row.blocked) return null;
    return withLog(row, [...log, notedSpell({ from: at, earlier: true }, note)]);
  }
  const spell = notedSpell(log[index], note);
  if (spell === log[index]) return row;
  const out = log.slice();
  out[index] = spell;
  return withLog(row, out);
}
