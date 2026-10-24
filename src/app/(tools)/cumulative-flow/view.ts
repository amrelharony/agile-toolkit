/**
 * What the Cumulative Flow page draws, whichever the source: the stages in
 * board order and the counts per stage per day, with the numbers read off
 * them (WIP, throughput, Little's Law, the measured cycle time). Pure, so
 * the page, its Markdown export, the tests and tool.cumulative_flow.*
 * (which builds the same pipeline from lib/flow on the server) agree.
 *
 * Board sources are computed live from the workspace through lib/flow:
 * storyItems / cardItems → dailyCounts, one point per calendar day (a
 * weekend is a flat stretch, not a gap). Typed snapshots are read as they
 * were typed: the first column waits, the last is done, the ones between
 * are work in progress.
 */

import {
  BOARD_WORKFLOW,
  SPRINT_WORKFLOW,
  cardItems,
  cycleSummary,
  dailyCounts,
  doneOf,
  finishedItems,
  littlesLaw,
  storyItems,
  wipOf,
  type CycleSummary,
  type FinishedItem,
  type FlowDay,
  type FlowItem,
  type FlowStage,
  type FlowWorkflow,
  type LittlesLaw,
} from "@/lib/flow";
import { enoughData } from "@/lib/analytics/min-sample";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import type { KanbanBoard, KanbanCard, Sprint, Story } from "@/lib/stores/workspace-types";
import type { CfdSource, DataEntry, StatusColumn } from "./types";

export interface CfdView {
  source: CfdSource;
  workflow: FlowWorkflow;
  /** One per day (board) or per snapshot (typed), oldest first. */
  days: FlowDay[];
  /** Board items placed from their stamps because their history wasn't kept. */
  approximate: number;
  /** The board's items finished in the range, with a cycle time (empty for typed). */
  finished: FinishedItem[];
  /** How many items the board has (0 for typed). */
  itemCount: number;
}

/** The days a sprint's chart covers: its start to today, or to its end once it's over. */
export function sprintRange(
  sprint: Pick<Sprint, "startDate" | "endDate">,
  today: string
): { from: string; to: string } | null {
  const start = isoDayNumber(sprint.startDate);
  const end = isoDayNumber(sprint.endDate);
  const now = isoDayNumber(today);
  if (start === null || now === null || now < start) return null;
  const to = end !== null && end >= start && end < now ? sprint.endDate : today;
  return { from: sprint.startDate, to };
}

/**
 * The last `days` days up to today, starting no earlier than the first
 * card came onto the board (so a new board isn't a long flat run of
 * zeros). Null without any card.
 */
export function flowRange(
  items: readonly FlowItem[],
  today: string,
  days: number
): { from: string; to: string } | null {
  const now = isoDayNumber(today);
  if (now === null) return null;
  let first: number | null = null;
  for (const item of items) {
    const n = isoDayNumber(item.arrivedOn);
    if (n !== null && (first === null || n < first)) first = n;
  }
  if (first === null) return null;
  const back = now - (Math.max(1, Math.floor(days)) - 1);
  // A card dated after today (another device's clock) still charts today.
  return { from: isoFromDayNumber(Math.min(now, Math.max(back, first))), to: today };
}

function boardView(
  source: "sprint" | "flow",
  items: FlowItem[],
  range: { from: string; to: string } | null
): CfdView {
  const workflow = source === "sprint" ? SPRINT_WORKFLOW : BOARD_WORKFLOW;
  if (!range) {
    return { source, workflow, days: [], approximate: 0, finished: [], itemCount: items.length };
  }
  const counts = dailyCounts(items, workflow, range);
  return {
    source,
    workflow,
    days: counts.days,
    approximate: counts.approximate,
    finished: finishedItems(items, range),
    itemCount: items.length,
  };
}

/** The selected sprint's board (its stories, as lib/flow places them), from its start to today. */
export function sprintView(
  stories: readonly Story[],
  sprint: Pick<Sprint, "id" | "startDate" | "endDate"> | undefined,
  today: string,
  opts: { includeExamples?: boolean } = {}
): CfdView {
  const items = sprint
    ? storyItems(stories, { sprint, includeExamples: opts.includeExamples })
    : [];
  return boardView("sprint", items, sprint && items.length ? sprintRange(sprint, today) : null);
}

/** The Flow board's cards over the last `days` days. */
export function flowView(
  board: Pick<KanbanBoard, "cards"> | undefined,
  today: string,
  days: number
): CfdView {
  const items = cardItems((board?.cards ?? []) as KanbanCard[]);
  return boardView("flow", items, flowRange(items, today, days));
}

/**
 * The typed columns as a workflow: the first waits, the last is done, the
 * ones between are work in progress. With two columns nothing is in
 * progress, so WIP reads "—", not 0.
 */
export function typedWorkflow(columns: readonly StatusColumn[]): FlowWorkflow {
  const stages: FlowStage[] = columns.map((c, i) => ({
    id: c.id,
    label: c.name,
    kind: i === columns.length - 1 ? "done" : i === 0 ? "queue" : "active",
  }));
  // The source only matters to dailyCounts, which typed snapshots don't go through.
  return { source: "flow", stages };
}

/** The snapshots by date, every column counted (one added later reads 0 before it existed). */
export function typedView(
  columns: readonly StatusColumn[],
  entries: readonly DataEntry[]
): CfdView {
  const workflow = typedWorkflow(columns);
  const days = [...entries]
    .filter((e) => isoDayNumber(e.date) !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      date: e.date,
      counts: Object.fromEntries(columns.map((c) => [c.id, e.counts[c.id] ?? 0])),
    }));
  return { source: "typed", workflow, days, approximate: 0, finished: [], itemCount: 0 };
}

/** A day of the chart with the totals read off it. */
export interface DayTotals {
  date: string;
  total: number;
  /** Null when the workflow has no in-progress stage. */
  wip: number | null;
  done: number;
}

export function dayTotals(day: FlowDay, workflow: FlowWorkflow): DayTotals {
  const total = workflow.stages.reduce((sum, s) => sum + (day.counts[s.id] ?? 0), 0);
  const active = workflow.stages.some((s) => s.kind === "active");
  return {
    date: day.date,
    total,
    wip: active ? wipOf(day, workflow) : null,
    done: doneOf(day, workflow),
  };
}

/** A fall in Done between two snapshots: Done is a running total, so it shouldn't. */
export interface DoneDrop {
  date: string;
  from: number;
  to: number;
}

export interface CfdMetrics {
  latest: DayTotals | null;
  /** WIP per point, for the control chart; empty without an in-progress stage. */
  wipSeries: { date: string; value: number }[];
  /** Points the chart has: days for a board, snapshots when typed. */
  points: number;
  /** Whether there are enough points to quote throughput and lead time (MIN_SAMPLE.average). */
  enough: boolean;
  /**
   * Little's Law over the points, by elapsed days: null below the sample
   * floor, or when nothing was finished in the range.
   */
  littles: LittlesLaw | null;
  /** Items finished per elapsed day; 0 when enough points but nothing finished; null below the floor. */
  throughputPerDay: number | null;
  /** The measured cycle time of the board's finished items (board sources), for a cross-check. */
  measured: CycleSummary | null;
  doneDrops: DoneDrop[];
}

export function cfdMetrics(view: CfdView): CfdMetrics {
  const totals = view.days.map((d) => dayTotals(d, view.workflow));
  const latest = totals[totals.length - 1] ?? null;
  const hasWip = view.workflow.stages.some((s) => s.kind === "active");
  const wipSeries = hasWip ? totals.map((t) => ({ date: t.date, value: t.wip ?? 0 })) : [];
  const points = totals.length;
  const enough = enoughData(points, "average");
  const law = enough
    ? littlesLaw(totals.map((t) => ({ date: t.date, wip: t.wip ?? 0, done: t.done })))
    : null;
  // Little's Law needs work in progress to say anything about lead time.
  const littles = law && hasWip ? law : null;
  const doneDrops: DoneDrop[] = [];
  for (let i = 1; i < totals.length; i++) {
    if (totals[i].done < totals[i - 1].done) {
      doneDrops.push({ date: totals[i].date, from: totals[i - 1].done, to: totals[i].done });
    }
  }
  return {
    latest,
    wipSeries,
    points,
    enough,
    littles,
    throughputPerDay: law ? law.throughputPerDay : enough && points >= 2 ? 0 : null,
    measured: view.source === "typed" ? null : cycleSummary(view.finished.map((f) => f.days)),
    doneDrops,
  };
}

/**
 * The Flow board's WIP limit for the in-progress stages together: the sum
 * of their columns' limits, only when every one has a limit (0 means none).
 * The Sprint board shares the Flow board's limits (kanban/sprint-view
 * SPRINT_COLUMNS wipKey), In progress and Review alike.
 */
export function boardWipLimit(board: Pick<KanbanBoard, "wipLimits"> | undefined): number | null {
  const limits = board?.wipLimits;
  if (!limits) return null;
  const active = [limits.in_progress, limits.review];
  return active.every((n) => typeof n === "number" && n > 0)
    ? active.reduce((a, b) => a + b, 0)
    : null;
}

/** Which source to open on: the sprint's stories, else the Flow board's cards, else typed snapshots. */
export function autoSource(has: {
  sprint: boolean;
  flow: boolean;
  typed: boolean;
}): CfdSource | null {
  if (has.sprint) return "sprint";
  if (has.flow) return "flow";
  if (has.typed) return "typed";
  return null;
}
