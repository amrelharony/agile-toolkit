/**
 * How many items sat in each stage, day by day: the cumulative flow
 * diagram's data, and the WIP and done counts Little's Law reads. Computed
 * live from the board items (./items), so the chart is never a copy that
 * goes stale.
 */

import { dayNumber, dayRange } from "./days";
import { stageWalk } from "./items";
import { workflowOf } from "./workflows";
import type { FlowItem, FlowWorkflow } from "./types";

/** One calendar day of the chart. */
export interface FlowDay {
  /** Local "YYYY-MM-DD". */
  date: string;
  /** Items in each stage at the end of the day, keyed by stage id; every stage is present. */
  counts: Readonly<Record<string, number>>;
}

export interface DailyCounts {
  workflow: FlowWorkflow;
  /** One per calendar day of the range, oldest first, with no gaps. */
  days: FlowDay[];
  /**
   * How many of the charted items were placed from their stamps because
   * their move history wasn't kept (`basis: "stamps"`), for a note under
   * the chart: their earlier days are approximate.
   */
  approximate: number;
}

/**
 * Items per stage for every calendar day from `range.from` to `range.to`
 * (both included, local days; empty days are filled, never skipped, so the
 * bands keep their width over a weekend). Cumulative-flow semantics: an
 * item counts in the stage it was in at the end of that day, from the day
 * it arrived; done items stay in done, so done is the running total of
 * finished work, and an item reopened leaves it. Items of the other board
 * (a story on BOARD_WORKFLOW, a card on SPRINT_WORKFLOW) are left out.
 */
export function dailyCounts(
  items: readonly FlowItem[],
  workflow: FlowWorkflow,
  range: { from: string; to: string }
): DailyCounts {
  const dates = dayRange(range.from, range.to);
  const numbers = dates.map((d) => dayNumber(d) as number);
  const stageIds = workflow.stages.map((s) => s.id);
  const ids = new Set(stageIds);
  const counts = dates.map(
    () => Object.fromEntries(stageIds.map((id) => [id, 0])) as Record<string, number>
  );
  let approximate = 0;
  for (const item of items) {
    if (workflowOf(item).source !== workflow.source) continue;
    const walk = stageWalk(item);
    let charted = false;
    numbers.forEach((n, i) => {
      const stage = walk(n);
      if (stage === null || !ids.has(stage)) return;
      counts[i][stage] += 1;
      charted = true;
    });
    if (charted && item.basis === "stamps") approximate += 1;
  }
  return {
    workflow,
    days: dates.map((date, i) => ({ date, counts: counts[i] })),
    approximate,
  };
}

/** Work in progress on the day: the items in the workflow's active stages (In progress, Review). */
export function wipOf(day: FlowDay, workflow: FlowWorkflow): number {
  return workflow.stages
    .filter((s) => s.kind === "active")
    .reduce((sum, s) => sum + (day.counts[s.id] ?? 0), 0);
}

/** The running total of finished items on the day: the workflow's done stage. */
export function doneOf(day: FlowDay, workflow: FlowWorkflow): number {
  return workflow.stages
    .filter((s) => s.kind === "done")
    .reduce((sum, s) => sum + (day.counts[s.id] ?? 0), 0);
}
