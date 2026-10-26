/**
 * Every method's score for one backlog item, in one shape.
 *
 * MoSCoW, WSJF, RICE and value/effort come from the BacklogItem's own
 * inputs. ICE, Kano and Cost of Delay come from the latest row in those
 * tools that is linked to the item. The Prioritizer's "All methods" tab and
 * `tool.prioritizer.list_state` both read this, so the agent sees the same
 * numbers as the screen.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { withBacklogDefaults, type FrameworkKey } from "./frameworks";

/** WSJF = (business value + time criticality + risk reduction) ÷ job size (at least 1). */
export function backlogWsjf(item: BacklogItem): number {
  // Phase 7 engine replaces this: a missing part reads as its old default.
  const v = withBacklogDefaults(item);
  const cod = v.businessValue + v.timeCriticality + v.riskReduction;
  return parseFloat((cod / Math.max(1, v.jobSize)).toFixed(2));
}

/** A finite number, else `fallback`. */
const finiteOr = (n: number | undefined, fallback: number): number =>
  n !== undefined && Number.isFinite(n) ? n : fallback;

/**
 * RICE = reach × impact × confidence% ÷ effort. Legacy rows missing a field
 * score as if it were 0 (effort 1) instead of NaN.
 */
export function backlogRice(item: BacklogItem): number {
  const reach = finiteOr(item.reach, 0);
  const impact = finiteOr(item.impact, 0);
  const confidence = finiteOr(item.confidence, 0);
  const effort = finiteOr(item.effort, 1);
  return parseFloat(((reach * impact * (confidence / 100)) / Math.max(0.1, effort)).toFixed(1));
}

export type MatrixQuadrant = "Quick Wins" | "Major Projects" | "Fill-ins" | "Time Sinks";

/** The Prioritizer's matrix: value above 5 is high, effort of 5 or less is low. */
export function matrixQuadrant(value: number, effort: number): MatrixQuadrant {
  const highValue = value > 5;
  const lowEffort = effort <= 5;
  if (highValue && lowEffort) return "Quick Wins";
  if (highValue) return "Major Projects";
  if (lowEffort) return "Fill-ins";
  return "Time Sinks";
}

export const KANO_LABELS: Record<string, string> = {
  "must-be": "Must-be",
  performance: "Performance",
  attractive: "Attractive",
  indifferent: "Indifferent",
  reverse: "Reverse",
};

/** The most recently updated row of `framework` linked to the backlog item. */
export function latestLinkedRow(
  rows: readonly PrioritizationItem[],
  backlogItemId: string,
  framework: FrameworkKey
): PrioritizationItem | undefined {
  let latest: PrioritizationItem | undefined;
  for (const row of rows) {
    if (row.backlogItemId !== backlogItemId || row.framework !== framework) continue;
    if (!latest || (row.updatedAt ?? "") >= (latest.updatedAt ?? "")) latest = row;
  }
  return latest;
}

export interface FrameworkScores {
  moscow: BacklogItem["moscow"];
  wsjf: number;
  rice: number;
  valueEffort: { value: number; effort: number; quadrant: MatrixQuadrant };
  /** ICE score (1–1000) from the latest linked ICE row, or null. */
  ice: number | null;
  /** Kano category id ("must-be", "performance", …) from the latest linked row, or null. */
  kano: string | null;
  /** Total cost of delay from the latest linked row, or null. */
  costOfDelay: number | null;
}

const finiteOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function frameworkScores(
  item: BacklogItem,
  rows: readonly PrioritizationItem[]
): FrameworkScores {
  const ice = latestLinkedRow(rows, item.id, "ice");
  const kano = latestLinkedRow(rows, item.id, "kano");
  const cod = latestLinkedRow(rows, item.id, "cost-of-delay");
  const kanoCategory = kano?.fields?.category;
  // Phase 7 engine replaces this: a missing matrix input reads as its old default.
  const { value, matrixEffort } = withBacklogDefaults(item);
  return {
    moscow: item.moscow,
    wsjf: backlogWsjf(item),
    rice: backlogRice(item),
    valueEffort: {
      value,
      effort: matrixEffort,
      quadrant: matrixQuadrant(value, matrixEffort),
    },
    ice: finiteOrNull(ice?.score),
    kano: typeof kanoCategory === "string" && kanoCategory ? kanoCategory : null,
    costOfDelay: finiteOrNull(cod?.score),
  };
}
