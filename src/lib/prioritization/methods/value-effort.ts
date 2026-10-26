/**
 * Value vs Effort: a 2×2 of the item's value against its effort.
 *
 * - Value is the backlog's one value field (BacklogItem.businessValue, the
 *   same as WSJF's business value) on the Fibonacci scale 1, 2, 3, 5, 8,
 *   13, 20, an ordinal axis with the seven steps evenly spaced. High value
 *   is 8 or more.
 * - Effort is BacklogItem.matrixEffort, 1–10. High effort is 6 or more
 *   (the symmetric 6–10 split).
 * - The quadrant is always derived, never stored: a stored
 *   `fields.quadrant` (display-cased from the old page, snake_case from the
 *   old agent actions) is ignored on read and dropped on the next write.
 * - The sort score is value ÷ effort; lists go quadrant by quadrant in
 *   do-first order (Quick Wins, Big Bets, Fill-Ins, Time Wasters).
 * - Both or neither: an item with neither is "Not placed yet"; one without
 *   the other is a form error.
 *
 * Rows store the value as `businessValue` (the item's key). Rows from
 * before the one value field hold the old 1–10 `value`, read onto the
 * Fibonacci scale at or above it (1→1, 2→2, 3→3, 4–5→5, 6–8→8, 9–10→13).
 */

import { fibonacciAtOrAbove, FIBONACCI_STEPS } from "./fibonacci";
import { readBacklogItem } from "../defaults";
import { defined, formatNumber, notScored, put, toNumber, toValidation } from "./fields";
import type {
  BucketDef,
  MethodInput,
  PrioritizationMethod,
  RowFields,
  ScaleStep,
  Values,
} from "./types";
import type { FormErrors } from "@/lib/utils/form";

export type ValueEffortQuadrant = "quick_wins" | "big_bets" | "fill_ins" | "time_wasters";

/** Do-first order: the order the tool lists them and Decide order ranks them. */
export const VE_QUADRANTS: readonly ValueEffortQuadrant[] = [
  "quick_wins",
  "big_bets",
  "fill_ins",
  "time_wasters",
];

export const VE_LABEL: Record<ValueEffortQuadrant, string> = {
  quick_wins: "Quick Wins",
  big_bets: "Big Bets",
  fill_ins: "Fill-Ins",
  time_wasters: "Time Wasters",
};

export const VE_MEANING: Record<ValueEffortQuadrant, string> = {
  quick_wins: "High value, low effort: do these first.",
  big_bets: "High value, high effort: plan them as investments.",
  fill_ins: "Low value, low effort: do them when there's room.",
  time_wasters: "Low value, high effort: drop or rethink them.",
};

/** Value of 8 or more is high (the Fibonacci value axis). */
export const VE_HIGH_VALUE_FROM = 8;
/** Effort of 6 or more is high (the 1–10 effort axis's upper half). */
export const VE_HIGH_EFFORT_FROM = 6;

/** The effort axis, 1–10, with what each value means. */
export const VE_EFFORT_STEPS: readonly ScaleStep[] = [
  { value: 1, meaning: "Under a day" },
  { value: 2, meaning: "A day or two" },
  { value: 3, meaning: "A few days" },
  { value: 4, meaning: "About a week" },
  { value: 5, meaning: "About two weeks" },
  { value: 6, meaning: "Two to three weeks" },
  { value: 7, meaning: "About a month" },
  { value: 8, meaning: "More than a month" },
  { value: 9, meaning: "About a quarter" },
  { value: 10, meaning: "Months of work across teams" },
];

/** The value axis: the Fibonacci steps, sized against the other items. */
export const VE_VALUE_STEPS: readonly ScaleStep[] = FIBONACCI_STEPS;

const BUCKETS: readonly BucketDef[] = [
  {
    id: "quick_wins",
    label: VE_LABEL.quick_wins,
    meaning: VE_MEANING.quick_wins,
    order: 0,
    tone: "success",
  },
  {
    id: "big_bets",
    label: VE_LABEL.big_bets,
    meaning: VE_MEANING.big_bets,
    order: 1,
    tone: "accent",
  },
  {
    id: "fill_ins",
    label: VE_LABEL.fill_ins,
    meaning: VE_MEANING.fill_ins,
    order: 2,
    tone: "muted",
  },
  {
    id: "time_wasters",
    label: VE_LABEL.time_wasters,
    meaning: VE_MEANING.time_wasters,
    order: 3,
    tone: "danger",
  },
];

const INPUTS: readonly MethodInput[] = [
  {
    key: "value",
    kind: "scale",
    label: "Value",
    hint: "Against the other items: 1 the smallest, 20 the largest. 8 or more is high.",
    missing: "Pick a value too, or leave both empty and place it on the matrix later.",
    backlogKey: "businessValue",
    steps: VE_VALUE_STEPS,
  },
  {
    key: "effort",
    kind: "scale",
    label: "Effort",
    hint: "1 under a day, 5 about two weeks, 10 months across teams. 6 or more is high.",
    missing: "Pick an effort too, or leave both empty and place it on the matrix later.",
    backlogKey: "matrixEffort",
    steps: VE_EFFORT_STEPS,
  },
];

/** The quadrant of a placed item; null until both are set (and effort is above 0). */
export function veQuadrant(
  value: number | undefined | null,
  effort: number | undefined | null
): ValueEffortQuadrant | null {
  if (value === undefined || value === null || effort === undefined || effort === null) return null;
  if (!Number.isFinite(value) || !Number.isFinite(effort) || effort <= 0) return null;
  const highValue = value >= VE_HIGH_VALUE_FROM;
  const highEffort = effort >= VE_HIGH_EFFORT_FROM;
  if (highValue) return highEffort ? "big_bets" : "quick_wins";
  return highEffort ? "time_wasters" : "fill_ins";
}

/** Value ÷ effort, unrounded; null until both are set. */
export function veScore(value: number | undefined, effort: number | undefined): number | null {
  if (value === undefined || effort === undefined || !(effort > 0)) return null;
  return Math.max(0, value) / effort;
}

export const isValueEffortQuadrant = (v: unknown): v is ValueEffortQuadrant =>
  typeof v === "string" && (VE_QUADRANTS as readonly string[]).includes(v);

function read(fields: Values | undefined): Values {
  return {
    value: toNumber(fields?.businessValue) ?? fibonacciAtOrAbove(toNumber(fields?.value)),
    effort: toNumber(fields?.effort),
  };
}

function write(fields: RowFields | undefined, v: Values): RowFields {
  const out: RowFields = { ...fields };
  // The legacy 1–10 `value` and the stored quadrant go: the value is now
  // `businessValue` and the quadrant is derived.
  delete out.value;
  delete out.quadrant;
  put(out, "businessValue", toNumber(v.value));
  put(out, "effort", toNumber(v.effort));
  return out;
}

export const VALUE_EFFORT: PrioritizationMethod = {
  id: "value-effort",
  toolId: "value-effort-matrix",
  label: "Value/Effort",
  embedded: true,
  inputs: INPUTS,
  buckets: BUCKETS,
  read,
  write,
  validate(draft) {
    const errors: FormErrors<string> = {};
    const value = toNumber(draft.value);
    const effort = toNumber(draft.effort);
    const blank = (k: "value" | "effort") =>
      draft[k] === undefined || (typeof draft[k] === "string" && String(draft[k]).trim() === "");
    // Neither is fine: the item goes to "Not placed yet". One alone is not.
    if (blank("value") && !blank("effort")) errors.value = INPUTS[0].missing;
    if (blank("effort") && !blank("value")) errors.effort = INPUTS[1].missing;
    if (!blank("value") && (value === undefined || value <= 0))
      errors.value = "Value is more than 0.";
    if (!blank("effort") && (effort === undefined || effort < 1 || effort > 10)) {
      errors.effort = "Effort runs from 1 to 10.";
    }
    return toValidation(draft, errors);
  },
  evaluate(v) {
    // `v` is already inputs (read or a draft): the legacy mapping is read()'s job.
    const value = toNumber(v.value);
    const effort = toNumber(v.effort);
    const missing: string[] = [];
    if (value === undefined) missing.push("value");
    if (effort === undefined || effort <= 0) missing.push("effort");
    const quadrant = veQuadrant(value, effort);
    const ratio = veScore(value, effort);
    if (!quadrant || ratio === null) return notScored(missing);
    const order = VE_QUADRANTS.indexOf(quadrant);
    return {
      score: ratio,
      bucket: quadrant,
      // Quadrant first (do-first order), then value ÷ effort within it; the
      // ratio stays far below the 1000 between quadrants.
      sortKey: (VE_QUADRANTS.length - order) * 1000 + ratio,
      missing: [],
      warnings: [],
      extra: { value: value as number, effort: effort as number },
    };
  },
  format: (score) => formatNumber(score, 2),
  owns: ["businessValue", "matrixEffort"],
  fromBacklog(item) {
    const r = readBacklogItem(item);
    return { value: r.businessValue, effort: r.matrixEffort };
  },
  toBacklog: (v) => defined({ businessValue: toNumber(v.value), matrixEffort: toNumber(v.effort) }),
};
