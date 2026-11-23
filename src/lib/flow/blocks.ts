/**
 * Reading blocked spells (lib/flow/block-stamps writes them): how long a
 * story or a Kanban card was blocked, inside a window or inside its own
 * cycle. Flow Insights' "blocked share of cycle time" and the Impediments
 * page's "where the time goes" both read through here, so a blocked day is
 * counted one way everywhere.
 *
 * The read rule for a spell's end (`spellEnd`):
 *   - its `to` when it has one;
 *   - else, for the one open spell (`openSpellIndex`, the last without
 *     `to`): the row's Done moment when the row is done (a write that
 *     moved it to Done without closing the spell), now while the row is
 *     still blocked, and otherwise nothing: the flag went off through a
 *     write that skipped the stamps, so the spell has zero length and is
 *     "not tracked";
 *   - an earlier spell without `to` (an import, or an agent setting its own
 *     log, can leave one) has zero length too: the stamps never reopen or
 *     close those.
 *
 * Time is elapsed time between moments, in ms (days = ms / 86,400,000),
 * never `cycleDays`, which counts a 2-hour item as a whole day. Pure: no
 * store, no React, server-safe for the agent actions.
 */

import type { BlockSpell, KanbanCard, Story } from "@/lib/stores/workspace-types";
import { BLOCK_TRACKING_SINCE, cleanBlockLog, openSpellIndex } from "./block-stamps";
import { localDay } from "@/lib/sprints/series";
import { momentOf } from "./stages";

export const DAY_MS = 86_400_000;

/** A story or a Kanban card, as the block readers read it. */
export type BlockRow = Pick<Story, "id" | "blocked" | "blockLog"> &
  Partial<Pick<Story, "status" | "doneAt" | "startedAt">> &
  Partial<Pick<KanbanCard, "column" | "completedAt">>;

/** A stretch of time in ms, `start` to `end`. */
export interface MsRange {
  start: number;
  end: number;
}

/** The row's spells as far as they can be read (a hand-edited or synced row never throws). */
export function spellsOf(row: Pick<BlockRow, "blockLog">): BlockSpell[] {
  return cleanBlockLog((row as { blockLog?: unknown }).blockLog) ?? [];
}

/** Whether the row is done: a story in done, or a card in the Done column. */
export function isDoneRow(row: BlockRow): boolean {
  return row.status === "done" || row.column === "done";
}

/** The row's Done moment in ms (`doneAt`, else `completedAt`), or null. */
export function doneMoment(row: BlockRow): number | null {
  const at = row.doneAt ?? row.completedAt;
  return typeof at === "string" ? momentOf(at) : null;
}

/** A spell read against its row: where it starts and ends, and whether its time counts. */
export interface ReadSpell {
  spell: BlockSpell;
  /** Its start in ms. */
  from: number;
  /** Its end in ms (`from` itself when it isn't tracked). */
  to: number;
  /** False when the spell has zero length because its end can't be known. */
  tracked: boolean;
  /** The spell still running: the open spell of a row that is still blocked. */
  open: boolean;
}

function msOf(now: number | Date): number {
  return typeof now === "number" ? now : now.getTime();
}

/**
 * The end of `spell` in ms by the read rule (see the module doc), or null
 * when it has none (zero length, "not tracked"). `isOpen`: the spell is the
 * row's open one (`openSpellIndex`); `readSpells` works this out itself.
 */
export function spellEnd(
  spell: BlockSpell,
  row: BlockRow,
  now: number | Date,
  isOpen = true
): number | null {
  const from = momentOf(spell.from);
  if (from === null) return null;
  if (spell.to !== undefined) {
    const to = momentOf(spell.to);
    return to === null ? null : Math.max(from, to);
  }
  if (!isOpen) return null;
  if (isDoneRow(row)) {
    const done = doneMoment(row);
    return done === null ? null : Math.max(from, done);
  }
  if (row.blocked) return Math.max(from, msOf(now));
  return null;
}

/** Each of the row's spells with its start and end by the read rule, oldest first. */
export function readSpells(row: BlockRow, now: number | Date): ReadSpell[] {
  const log = spellsOf(row);
  const open = openSpellIndex(log);
  const out: ReadSpell[] = [];
  log.forEach((spell, i) => {
    const from = momentOf(spell.from);
    if (from === null) return;
    const end = spellEnd(spell, row, now, i === open);
    out.push({
      spell,
      from,
      to: end ?? from,
      tracked: end !== null,
      open: i === open && spell.to === undefined && !isDoneRow(row) && Boolean(row.blocked),
    });
  });
  return out;
}

/**
 * Blocked since before tracking: the row is blocked (and not done) with no
 * open spell, so its time can't be counted. The page says "Blocked since
 * before tracking"; nothing is stored for it.
 */
export function untrackedBlock(row: BlockRow): boolean {
  if (!row.blocked || isDoneRow(row)) return false;
  return openSpellIndex(spellsOf(row)) < 0;
}

/** The overlap of two stretches in ms (0 when they don't meet). */
export function overlapMs(a: MsRange, b: MsRange): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * The spell's elapsed ms by the read rule, only the part inside `range`
 * when one is given. 0 for a spell that isn't tracked.
 */
export function spellMs(
  spell: BlockSpell,
  row: BlockRow,
  now: number | Date,
  range?: MsRange,
  isOpen = true
): number {
  const from = momentOf(spell.from);
  const end = spellEnd(spell, row, now, isOpen);
  if (from === null || end === null) return 0;
  const own = { start: from, end };
  return range ? overlapMs(own, range) : end - from;
}

/** Elapsed ms as days, with a fraction. */
export const msToDays = (ms: number) => ms / DAY_MS;

/** Local midnight of a "YYYY-MM-DD" (or a stamp's local day) in ms, or null. */
export function dayStartMs(day: string | null | undefined): number | null {
  const d = localDay(day);
  return d ? momentOf(d) : null;
}

/** A finished row's cycle and the blocked time inside it, both in elapsed ms. */
export interface BlockedInCycle {
  cycleMs: number;
  blockedMs: number;
}

/**
 * The row's cycle (from `startedAt` to its Done moment) and the blocked
 * time inside it: the overlap of its spells with the cycle. Null when it
 * isn't done, has no start or no done moment, or started before
 * BLOCK_TRACKING_SINCE (its blocks then weren't recorded).
 */
export function blockedInCycle(row: BlockRow, now: number | Date): BlockedInCycle | null {
  if (!isDoneRow(row) || typeof row.startedAt !== "string") return null;
  const start = momentOf(row.startedAt);
  const end = doneMoment(row);
  if (start === null || end === null || end < start) return null;
  const startDay = localDay(row.startedAt);
  if (!startDay || startDay < BLOCK_TRACKING_SINCE) return null;
  const cycle = { start, end };
  let blockedMs = 0;
  for (const s of readSpells(row, now)) {
    blockedMs += overlapMs({ start: s.from, end: s.to }, cycle);
  }
  return { cycleMs: end - start, blockedMs: Math.min(blockedMs, end - start) };
}
