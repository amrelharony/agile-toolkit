/**
 * How a Flow-board card moves and how long cards take, shared by the Kanban
 * page (src/app/(tools)/kanban/flow-view.ts re-exports these) and the
 * tool.kanban.* agent actions, so a move stamps a card the same way and
 * cycle time is counted the same way wherever it happens. Cycle time is
 * lib/flow's: whole local days, start and finish day both counted, so the
 * Flow board, its agent actions, next steps and the Track delivery tools
 * quote one number.
 */

import type { KanbanCard, KanbanColumnId } from "@/lib/stores/workspace-types";
import { cycleDays, cycleSummary } from "@/lib/flow/cycle";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** At most this many column moves are kept per card (the latest). */
export const KANBAN_HISTORY_CAP = 50;

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

/**
 * Whole local days from start to completion, both counted (lib/flow
 * cycleDays): a card started and finished on the same day took 1 day.
 * Null without both stamps, or when the completion comes first.
 */
export function cycleTimeDays(card: Pick<KanbanCard, "startedAt" | "completedAt">): number | null {
  return cycleDays(card.startedAt, card.completedAt);
}

export interface CycleStats {
  /** Done cards with a start and a completion. */
  count: number;
  /** Mean whole days (`cycleTimeDays`); null without any. Quote it from MIN_SAMPLE.average cards. */
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

/** The cycle time of the cards in Done, by lib/flow cycleSummary (Cycle Time's own numbers). */
export function cycleStats(cards: readonly KanbanCard[]): CycleStats {
  const days = finishedCards(cards)
    .map(cycleTimeDays)
    .filter((d): d is number => d !== null);
  const { count, average, spread, p85 } = cycleSummary(days);
  return { count, average, spread, p85 };
}
