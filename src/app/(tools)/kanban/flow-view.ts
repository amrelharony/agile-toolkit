/**
 * The Flow board's logic, pure so the board, its Markdown export and the
 * tests read the same numbers: how a move stamps a card, how long a card has
 * sat in its column, cycle-time statistics, weekly throughput and the
 * one-sentence verdict.
 */

import type { KanbanCard, KanbanColumnId } from "@/lib/stores/workspace-types";
import { DAY_MS, finishedCards, type CycleStats } from "@/lib/kanban/flow";
import {
  throughputByWeek,
  throughputLastWeek as flowThroughputLastWeek,
  type ThroughputPoint,
} from "@/lib/flow/throughput";
import { localDay, todayIso } from "@/lib/sprints/series";
import { enoughData, needMore } from "@/lib/analytics/min-sample";
import { fmt, move, plural, type ChartText } from "@/lib/charts/chart-text";
import type { Validation } from "@/lib/utils/form";

// How a move stamps a card and how cycle time is counted are shared with the
// tool.kanban.* agent actions (lib/kanban/flow); weeks are lib/flow's.
export {
  DAY_MS,
  KANBAN_HISTORY_CAP,
  WORKING,
  cycleStats,
  cycleTimeDays,
  finishedCards,
  movedCard,
  type CycleStats,
} from "@/lib/kanban/flow";
export { isoWeek } from "@/lib/flow/throughput";

export const FLOW_COLUMNS: readonly { id: KanbanColumnId; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "ready", label: "Ready" },
  { id: "in_progress", label: "In progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

export const FLOW_COLUMN_LABEL = Object.fromEntries(
  FLOW_COLUMNS.map((c) => [c.id, c.label])
) as Record<KanbanColumnId, string>;

/** Backlog and Done are queues, not work in progress: the board never limits them. */
export const isLimited = (col: KanbanColumnId) => col !== "backlog" && col !== "done";

export const DEFAULT_WIP_LIMITS: Record<KanbanColumnId, number> = {
  backlog: 0,
  ready: 5,
  in_progress: 3,
  review: 2,
  done: 0,
};

/** The add form's draft: a title is required, the description is optional. */
export interface CardDraft {
  title: string;
  description: string;
}

export const EMPTY_CARD_DRAFT: CardDraft = { title: "", description: "" };

export interface CardValues {
  title: string;
  description?: string;
}

/** A card needs a title; Add with a blank one says so instead of doing nothing. */
export function validateCard(d: CardDraft): Validation<CardValues, "title"> {
  const title = d.title.trim();
  if (!title) return { ok: false, errors: { title: "Enter a card title." } };
  const description = d.description.trim();
  return { ok: true, values: description ? { title, description } : { title } };
}

const parse = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** The latest of some dates, or null when none of them is one. */
function latestOf(isos: readonly (string | undefined)[]): string | null {
  let best: { iso: string; t: number } | null = null;
  for (const iso of isos) {
    const t = parse(iso);
    if (t !== null && (best === null || t > best.t)) best = { iso: iso as string, t };
  }
  return best?.iso ?? null;
}

/**
 * When the card entered its column: the later of `columnSince` and the
 * stamp the column writes (the completion for Done, the start for In
 * progress and Review). An agent's `move_card` writes those stamps but not
 * `columnSince`, which would otherwise date the stay from the column the
 * card left. Cards from before `columnSince` existed read the same stamps,
 * then a done card's start, else when the card was created.
 */
export function cardColumnSince(card: KanbanCard): string | null {
  const own =
    card.column === "done"
      ? latestOf([card.columnSince, card.completedAt])
      : card.column === "in_progress" || card.column === "review"
        ? latestOf([card.columnSince, card.startedAt])
        : latestOf([card.columnSince]);
  if (own) return own;
  const older = card.column === "done" ? [card.startedAt, card.createdAt] : [card.createdAt];
  return older.find((iso) => parse(iso) !== null) ?? null;
}

/**
 * Whole days the card has been worked on: from its start, which moving
 * between In progress and Review keeps (the age badge restarts there), else
 * from when it entered its column. What the ageing tint compares with the
 * P85 cycle time, which runs from start to done too.
 */
export function daysInWork(card: KanbanCard, now: Date): number | null {
  return daysSince(parse(card.startedAt) !== null ? card.startedAt : cardColumnSince(card), now);
}

/** Whole days from `iso` to `now` (0 on the day itself), or null when unknown. */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  const t = parse(iso ?? undefined);
  if (t === null) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** The cards in Done by their local completion day, as lib/flow's throughput helpers count them. */
const doneDays = (cards: readonly KanbanCard[]) =>
  finishedCards(cards).map((c) => ({ doneOn: localDay(c.completedAt) }));

/** Cards completed in the 7 local days up to and including `now`'s (lib/flow throughputLastWeek). */
export function throughputLastWeek(cards: readonly KanbanCard[], now: Date): number {
  return flowThroughputLastWeek(doneDays(cards), todayIso(now));
}

/** "2026-W42" and the cards finished that week. */
export type WeekPoint = ThroughputPoint;

/**
 * Cards completed per ISO week, gaps as 0 (lib/flow throughputByWeek, which
 * says why). Only cards in Done count (`finishedCards`).
 */
export function weeklyThroughput(cards: readonly KanbanCard[]): WeekPoint[] {
  return throughputByWeek(doneDays(cards));
}

/** The throughput chart's summary sentence and its data as a table. */
export function throughputChartText(series: readonly WeekPoint[]): ChartText {
  const total = series.reduce((sum, p) => sum + p.value, 0);
  const first = series[0];
  const last = series[series.length - 1];
  const summary =
    series.length < 2
      ? `${plural(total, "card")} finished so far.`
      : `Cards finished per week ${move(first.value, last.value)} over ${plural(series.length, "week")}; ${plural(total, "card")} finished in all.`;
  return {
    summary,
    table: {
      columns: ["Week", "Cards finished"],
      rows: series.map((p) => [p.label, p.value]),
      caption: "Cards finished per week",
    },
  };
}

export interface FlowBreach {
  column: KanbanColumnId;
  label: string;
  count: number;
  limit: number;
}

/** Limited columns holding more cards than their WIP limit, in board order. */
export function flowBreaches(
  cards: readonly KanbanCard[],
  wipLimits: Record<KanbanColumnId, number>
): FlowBreach[] {
  return FLOW_COLUMNS.flatMap(({ id, label }) => {
    const limit = wipLimits[id] ?? 0;
    if (!isLimited(id) || limit <= 0) return [];
    const count = cards.filter((c) => c.column === id).length;
    return count > limit ? [{ column: id, label, count, limit }] : [];
  });
}

/**
 * One sentence on the board: what most needs attention (a column over its
 * limit, blocked cards), else how fast cards flow once there are enough to
 * say, else what to do to find out.
 */
export function flowVerdict(
  cards: readonly KanbanCard[],
  wipLimits: Record<KanbanColumnId, number>,
  stats: CycleStats
): string {
  if (cards.length === 0) return "No cards on the board yet.";
  const breach = flowBreaches(cards, wipLimits)[0];
  if (breach) {
    return `${breach.label} has ${plural(breach.count, "card")} against a limit of ${breach.limit}: finish something before starting more.`;
  }
  const active = cards.filter((c) => c.column === "in_progress" || c.column === "review");
  const blocked = active.filter((c) => c.blocked).length;
  if (blocked > 0) {
    return `${blocked} of ${plural(active.length, "card")} in progress ${blocked === 1 ? "is" : "are"} blocked: clear ${blocked === 1 ? "it" : "them"} before pulling more work.`;
  }
  if (stats.average !== null && enoughData(stats.count, "average")) {
    const p85 =
      stats.p85 !== null && enoughData(stats.count, "distribution")
        ? `, and 85% finished within ${plural(Number(fmt(stats.p85)), "day")}`
        : "";
    return `Cards take ${plural(Number(fmt(stats.average)), "day")} on average from start to done${p85}.`;
  }
  const more = needMore(stats.count, "average");
  return `${plural(active.length, "card")} in progress; finish ${more} more to see how long cards take.`;
}
