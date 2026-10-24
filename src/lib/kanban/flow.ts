/**
 * How a Flow-board card moves and how long cards take, shared by the Kanban
 * page (src/app/(tools)/kanban/flow-view.ts re-exports these) and the
 * tool.kanban.* agent actions, so a move stamps a card the same way and
 * cycle time is counted the same way wherever it happens.
 */

import type { KanbanCard, KanbanColumnId } from "@/lib/stores/workspace-types";
import { percentile } from "@/lib/sprints/metrics";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** At most this many column moves are kept per card (the latest). */
export const KANBAN_HISTORY_CAP = 50;

const parse = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Columns where a card is being worked on: entering one starts its cycle time. */
export const WORKING: ReadonlySet<KanbanColumnId> = new Set<KanbanColumnId>([
  "in_progress",
  "review",
]);

/**
 * `card` moved to `col` at `at`. The same card (by reference) when it is
 * already there. Entering In progress or Review stamps `startedAt` when it
 * has none (a card pulled straight into Review was worked on too, and would
 * otherwise never count towards cycle time), entering Done stamps
 * `completedAt`. A card dropped straight from Backlog or Ready into Done
 * gets no start: nobody saw it worked on, so it has no cycle time rather
 * than a made-up 0 days. Leaving Done drops the completion, so a reopened
 * card no longer counts as throughput, and going back to Backlog or Ready
 * drops the start, so the next attempt's cycle time starts afresh.
 * `columnSince` always restarts: it is what the age-in-column badge counts
 * from. A done card can't be blocked, so the flag goes too. The move is
 * added to `history` (the latest `KANBAN_HISTORY_CAP`), so a cumulative
 * flow can tell how long the card spent in Ready and Review, which the
 * stamps alone lose.
 */
export function movedCard(card: KanbanCard, col: KanbanColumnId, at: string): KanbanCard {
  if (card.column === col) return card;
  const next: KanbanCard = {
    ...card,
    column: col,
    columnSince: at,
    history: [...(card.history ?? []), { column: col, from: card.column, at }].slice(
      -KANBAN_HISTORY_CAP
    ),
  };
  if (WORKING.has(col) && !card.startedAt) next.startedAt = at;
  if (col === "done") {
    if (!card.completedAt) next.completedAt = at;
    delete next.blocked;
  } else {
    delete next.completedAt;
  }
  if (col === "backlog" || col === "ready") delete next.startedAt;
  return next;
}

/** Days from start to completion, or null without both stamps. */
export function cycleTimeDays(card: Pick<KanbanCard, "startedAt" | "completedAt">): number | null {
  const start = parse(card.startedAt);
  const end = parse(card.completedAt);
  if (start === null || end === null) return null;
  return Math.max(0, (end - start) / DAY_MS);
}

export interface CycleStats {
  /** Done cards with a start and a completion. */
  count: number;
  /** Mean days; null without any. Quote it from MIN_SAMPLE.average cards. */
  average: number | null;
  /** Standard deviation in days; quote it from MIN_SAMPLE.distribution. */
  spread: number | null;
  /** 85% of cards finished within this many days (nearest rank, the shared
   *  `percentile`); quote it from MIN_SAMPLE.distribution. */
  p85: number | null;
}

/**
 * A card counts as finished while it is in Done. The completion stamp alone
 * isn't enough: a card moved out of Done before moves dropped it (an older
 * agent write) still has one.
 */
export const finishedCards = (cards: readonly KanbanCard[]) =>
  cards.filter((c) => c.column === "done");

export function cycleStats(cards: readonly KanbanCard[]): CycleStats {
  const days = finishedCards(cards)
    .map(cycleTimeDays)
    .filter((d): d is number => d !== null);
  const count = days.length;
  if (count === 0) return { count, average: null, spread: null, p85: null };
  const average = days.reduce((a, b) => a + b, 0) / count;
  const variance = days.reduce((sum, d) => sum + (d - average) ** 2, 0) / count;
  return { count, average, spread: Math.sqrt(variance), p85: percentile(days, 85) };
}
