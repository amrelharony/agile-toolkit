/**
 * Every method's score for one backlog item, in one shape.
 *
 * MoSCoW, WSJF, RICE and value/effort come from the BacklogItem's own
 * inputs (old defaults cleared, the legacy value read onto the one value
 * field, and what a row linked before Phase 7 still holds where the old
 * defaults hid the item's: methods withLegacyLinks). ICE, Kano and Cost
 * of Delay come from the latest row in those
 * tools that is linked to the item. Every number comes from the method
 * registry (./methods), the same code the tools, Sprint Planning and the
 * agent actions use; a method that isn't scored reads null, never a
 * mid-range default. The Prioritizer's "All methods" tab and
 * `tool.prioritizer.list_state` both read this, so the agent sees the
 * same numbers as the screen.
 */

import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";
import { evaluateItemIn, latestLinkedRow, type EvalContext } from "./methods";
import { KANO_CATEGORY_LABEL, type KanoCategory } from "./methods/kano";
import { isValueEffortQuadrant, type ValueEffortQuadrant } from "./methods/value-effort";
import { COD_URGENCIES, type CodUrgency } from "./methods/cost-of-delay";
import { toChoice } from "./methods/fields";

export { latestLinkedRow };

/** WSJF of the item's own inputs, unrounded; null until all four parts are set. */
export function backlogWsjf(item: BacklogItem): number | null {
  return evaluateItemIn(item, [], "wsjf").score;
}

/** RICE of the item's own inputs (reach per quarter), unrounded; null until all are set. */
export function backlogRice(item: BacklogItem): number | null {
  return evaluateItemIn(item, [], "rice").score;
}

/** The hub's Kano labels, from the Kano method. */
export const KANO_LABELS: Record<string, string> = KANO_CATEGORY_LABEL;

export interface FrameworkScores {
  /** The MoSCoW bucket; absent: Not sorted yet. */
  moscow: BacklogItem["moscow"];
  /** WSJF, or null when not scored. */
  wsjf: number | null;
  /** RICE, or null when not scored. */
  rice: number | null;
  /** The item's value (Fibonacci) and matrix effort with the derived quadrant; null until both are set. */
  valueEffort: { value: number; effort: number; quadrant: ValueEffortQuadrant } | null;
  /** ICE score (1–1000) from the latest linked ICE row, or null. */
  ice: number | null;
  /** Kano category from the latest linked row (derived from its answers), or null. */
  kano: KanoCategory | null;
  /**
   * @deprecated The old total cost of delay (per week × weeks delayed),
   * only for a linked row from before CD3 that still holds one; null
   * otherwise. Read `cd3`.
   */
  costOfDelay: number | null;
  /** CD3 (cost of delay per week ÷ duration) from the latest linked row, or null. */
  cd3: number | null;
  /** That row's urgency profile, or null. */
  urgency: CodUrgency | null;
}

export function frameworkScores(
  item: BacklogItem,
  rows: readonly PrioritizationItem[],
  ctx?: EvalContext
): FrameworkScores {
  const moscow = evaluateItemIn(item, rows, "moscow", ctx);
  const ve = evaluateItemIn(item, rows, "value-effort", ctx);
  const kano = evaluateItemIn(item, rows, "kano", ctx);
  const cod = evaluateItemIn(item, rows, "cost-of-delay", ctx);
  const veValue = ve.extra?.value;
  const veEffort = ve.extra?.effort;
  const total = cod.extra?.totalCost;
  return {
    moscow: (toChoice(["must", "should", "could", "wont"] as const, moscow.bucket) ??
      undefined) as BacklogItem["moscow"],
    wsjf: evaluateItemIn(item, rows, "wsjf", ctx).score,
    rice: evaluateItemIn(item, rows, "rice", ctx).score,
    valueEffort:
      isValueEffortQuadrant(ve.bucket) &&
      typeof veValue === "number" &&
      typeof veEffort === "number"
        ? { value: veValue, effort: veEffort, quadrant: ve.bucket }
        : null,
    ice: evaluateItemIn(item, rows, "ice", ctx).score,
    kano: (kano.bucket as KanoCategory | null) ?? null,
    costOfDelay: typeof total === "number" ? total : null,
    cd3: cod.score,
    urgency: toChoice(COD_URGENCIES, cod.bucket) ?? null,
  };
}
