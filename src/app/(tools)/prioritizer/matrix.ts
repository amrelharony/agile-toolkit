/**
 * Backlog Prioritizer — the Value vs Effort tab's points and their text
 * alternative (the chart's summary and table).
 *
 * The quadrant is the Value/Effort method's (lib/prioritization/methods/
 * value-effort): value on the Fibonacci steps, an ordinal axis with the
 * seven steps evenly spaced, high from 8; effort 1–10, high from 6. Pure,
 * so the summary and table are ready before the chart's code loads.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import type { ChartTable } from "@/lib/charts/chart-text";
import { compareResults, evaluateItemIn, method } from "@/lib/prioritization/methods";
import { FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";
import {
  VE_HIGH_EFFORT_FROM,
  VE_HIGH_VALUE_FROM,
  VE_LABEL,
  VE_QUADRANTS,
  isValueEffortQuadrant,
  type ValueEffortQuadrant,
} from "@/lib/prioritization/methods/value-effort";
import { countText, itemName, listText } from "./method-text";

export interface MatrixPoint {
  id: string;
  name: string;
  value: number;
  effort: number;
  /** Where the value sits on the ordinal axis: the step's index, between two for an off-scale value. */
  valueAt: number;
  quadrant: ValueEffortQuadrant;
}

/** A value's place on the evenly spaced Fibonacci axis (0 = 1, 6 = 20). */
export function valueAt(value: number): number {
  const steps = FIBONACCI_VALUES as readonly number[];
  if (value <= steps[0]) return 0;
  for (let i = 1; i < steps.length; i++) {
    if (value <= steps[i]) return i - 1 + (value - steps[i - 1]) / (steps[i] - steps[i - 1]);
  }
  return steps.length - 1;
}

/** Where the quadrant lines are drawn: between the last low step and the first high one. */
export const VALUE_SPLIT_AT = valueAt(VE_HIGH_VALUE_FROM) - 0.5;
export const EFFORT_SPLIT_AT = VE_HIGH_EFFORT_FROM - 0.5;

/**
 * The placed items in do-first order (quadrant by quadrant, then value ÷
 * effort), and the ones not placed yet. With the workspace's method `rows`,
 * a Value/Effort row linked before Phase 7 places its item where its old
 * defaults hide the value and effort (methods withLegacyLinks), as the
 * Value vs Effort tool reads it.
 */
export function matrixPoints(
  items: readonly BacklogItem[],
  rows: readonly PrioritizationItem[] = []
): {
  points: MatrixPoint[];
  unplaced: BacklogItem[];
} {
  const m = method("value-effort");
  const placed: { point: MatrixPoint; result: ReturnType<typeof evaluateItemIn> }[] = [];
  const unplaced: BacklogItem[] = [];
  for (const item of items) {
    const result = evaluateItemIn(item, rows, "value-effort");
    const value = result.extra?.value;
    const effort = result.extra?.effort;
    if (
      !isValueEffortQuadrant(result.bucket) ||
      typeof value !== "number" ||
      typeof effort !== "number"
    ) {
      unplaced.push(item);
      continue;
    }
    placed.push({
      point: {
        id: item.id,
        name: item.name,
        value,
        effort,
        valueAt: valueAt(value),
        quadrant: result.bucket,
      },
      result,
    });
  }
  placed.sort((a, b) => compareResults(m, a.result, b.result));
  return { points: placed.map((p) => p.point), unplaced };
}

/** The chart's summary sentence and its table. */
export function matrixText(
  points: readonly MatrixPoint[],
  unplaced: number
): {
  summary: string;
  table: ChartTable;
} {
  const tail = unplaced > 0 ? `; ${countText(unplaced, "item")} not placed yet` : "";
  let summary: string;
  if (points.length === 0) {
    summary = `No item is placed yet: give an item a value and an effort${tail}.`;
  } else {
    const counts = VE_QUADRANTS.map((q) => ({
      q,
      n: points.filter((p) => p.quadrant === q).length,
    }))
      .filter((c) => c.n > 0)
      .map((c) => `${c.n} ${VE_LABEL[c.q]}`);
    const first = points[0];
    const lead =
      first.quadrant === "quick_wins"
        ? `; do first: “${itemName(first.name)}” (value ${first.value}, effort ${first.effort})`
        : "";
    summary = `${countText(points.length, "item")} placed: ${listText(counts)}${lead}${tail}.`;
  }
  return {
    summary,
    table: {
      columns: ["Item", "Value", "Effort", "Quadrant"],
      rows: points.map((p) => [p.name, p.value, p.effort, VE_LABEL[p.quadrant]]),
      caption: "Value vs effort, in do-first order",
    },
  };
}
