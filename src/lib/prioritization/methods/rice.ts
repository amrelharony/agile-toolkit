/**
 * RICE (Intercom): reach × impact × confidence ÷ effort.
 *
 * - Reach is people (or events) per period, the period chosen per item
 *   (week, month, quarter or year). The score normalises reach to per
 *   quarter, so items counted over different periods compare. A row or
 *   item without a period counts per quarter, what Reach always meant.
 * - Impact is per person reached: 3 massive, 2 high, 1 medium, 0.5 low,
 *   0.25 minimal. The exact value is kept (a custom 1.5 stays 1.5).
 * - Confidence is a percentage: 100 high, 80 medium, 50 low, with examples.
 * - Effort is person-months, at least 0.5 (Intercom's smallest unit).
 *   Forms refuse less; a legacy stored effort below 0.5 scores as 0.5 and
 *   says so; 0 or none is Not scored.
 */

import { REACH_PERIODS, type ReachPeriod } from "@/lib/stores/workspace-types";
import { readBacklogItem } from "../defaults";
import {
  defined,
  formatNumber,
  inputErrors,
  missingKeys,
  notScored,
  put,
  toChoice,
  toNumber,
  toValidation,
} from "./fields";
import type { MethodInput, PrioritizationMethod, RowFields, ScaleStep, Values } from "./types";

export { REACH_PERIODS, type ReachPeriod };

/** How many of a period make a quarter: reach × this = reach per quarter. */
export const REACH_PER_QUARTER: Record<ReachPeriod, number> = {
  week: 13,
  month: 3,
  quarter: 1,
  year: 0.25,
};

export const REACH_PERIOD_LABEL: Record<ReachPeriod, string> = {
  week: "per week",
  month: "per month",
  quarter: "per quarter",
  year: "per year",
};

/** What a row or item without a period counts over (the old "people per quarter"). */
export const LEGACY_REACH_PERIOD: ReachPeriod = "quarter";

/** The smallest effort, in person-months. */
export const RICE_EFFORT_MIN = 0.5;

/** Impact per person reached (Intercom's scale). */
export const RICE_IMPACT_STEPS: readonly ScaleStep[] = [
  { value: 3, name: "Massive", meaning: "Massive change for each person" },
  { value: 2, name: "High", meaning: "High change for each person" },
  { value: 1, name: "Medium", meaning: "Medium change for each person" },
  { value: 0.5, name: "Low", meaning: "Low change for each person" },
  { value: 0.25, name: "Minimal", meaning: "Minimal change for each person" },
];

/** Confidence, as a percentage, each with an example of what earns it. */
export const RICE_CONFIDENCE_STEPS: readonly ScaleStep[] = [
  {
    value: 100,
    name: "High",
    meaning: "Backed by data",
    example: "Usage data or an experiment shows the reach and the impact.",
  },
  {
    value: 80,
    name: "Medium",
    meaning: "Some evidence",
    example: "Customer interviews or support tickets back one of the numbers.",
  },
  {
    value: 50,
    name: "Low",
    meaning: "Mostly a guess",
    example: "The team's best estimate, with little evidence yet.",
  },
];

/** Shown with the confidence rubric. */
export const RICE_MOONSHOT_TEXT = "Under 50% is a moonshot: test it first.";

const INPUTS: readonly MethodInput[] = [
  {
    key: "reach",
    kind: "number",
    label: "Reach",
    hint: "People (or events) reached in the period.",
    missing: "Enter the reach.",
    backlogKey: "reach",
    min: 0,
    unit: "people",
  },
  {
    key: "reachPeriod",
    kind: "choice",
    label: "Reach period",
    hint: "The score counts reach per quarter, so items with different periods compare.",
    missing: "Pick the period the reach counts over.",
    backlogKey: "reachPeriod",
    options: REACH_PERIODS.map((id) => ({ id, label: REACH_PERIOD_LABEL[id] })),
  },
  {
    key: "impact",
    kind: "scale",
    label: "Impact",
    hint: "Per person reached: 3 massive, 2 high, 1 medium, 0.5 low, 0.25 minimal.",
    missing: "Pick an impact.",
    backlogKey: "impact",
    steps: RICE_IMPACT_STEPS,
    format: "x",
  },
  {
    key: "confidence",
    kind: "scale",
    label: "Confidence",
    hint: `100% backed by data, 80% some evidence, 50% mostly a guess. ${RICE_MOONSHOT_TEXT}`,
    missing: "Pick a confidence.",
    backlogKey: "confidence",
    steps: RICE_CONFIDENCE_STEPS,
    format: "pct",
  },
  {
    key: "effort",
    kind: "number",
    label: "Effort",
    hint: "Person-months of work, 0.5 at least.",
    missing: "Enter the effort.",
    backlogKey: "effort",
    min: RICE_EFFORT_MIN,
    step: 0.5,
    unit: "person-months",
  },
];

export interface RiceValues {
  reach: number;
  reachPeriod: ReachPeriod;
  impact: number;
  confidence: number;
  effort: number;
}

/** Reach counted per quarter. */
export const reachPerQuarter = (reach: number, period: ReachPeriod): number =>
  Math.max(0, reach) * REACH_PER_QUARTER[period];

/**
 * RICE of a complete set of inputs, unrounded: reach per quarter × impact
 * × confidence% ÷ effort, effort at least 0.5 and confidence held to 0–100%.
 */
export function riceScore(v: RiceValues): number {
  const confidence = Math.min(100, Math.max(0, v.confidence)) / 100;
  return (
    (reachPerQuarter(v.reach, v.reachPeriod) * Math.max(0, v.impact) * confidence) /
    Math.max(RICE_EFFORT_MIN, v.effort)
  );
}

/**
 * Where a row keeps its confidence. The UI writes `confidence`; rows saved
 * by the agent actions before Phase 7 carry `confidencePct`. A write goes
 * back to the key the row already uses, so its stored shape doesn't change.
 */
export function confidenceKey(fields: Values | undefined): "confidence" | "confidencePct" {
  return fields && fields.confidence === undefined && fields.confidencePct !== undefined
    ? "confidencePct"
    : "confidence";
}

function read(fields: Values | undefined): Values {
  return {
    reach: toNumber(fields?.reach),
    reachPeriod: toChoice(REACH_PERIODS, fields?.reachPeriod) ?? LEGACY_REACH_PERIOD,
    impact: toNumber(fields?.impact),
    confidence: toNumber(fields?.confidence) ?? toNumber(fields?.confidencePct),
    effort: toNumber(fields?.effort),
  };
}

function write(fields: RowFields | undefined, v: Values): RowFields {
  const out: RowFields = { ...fields };
  put(out, "reach", toNumber(v.reach));
  put(out, "reachPeriod", toChoice(REACH_PERIODS, v.reachPeriod));
  put(out, "impact", toNumber(v.impact));
  put(out, confidenceKey(fields), toNumber(v.confidence));
  put(out, "effort", toNumber(v.effort));
  return out;
}

export const RICE: PrioritizationMethod = {
  id: "rice",
  toolId: "rice-scoring",
  label: "RICE",
  embedded: true,
  inputs: INPUTS,
  read,
  write,
  validate(draft) {
    const errors = inputErrors(INPUTS, draft);
    const impact = toNumber(draft.impact);
    if (!errors.impact && impact !== undefined && impact <= 0)
      errors.impact = "Impact is more than 0.";
    const confidence = toNumber(draft.confidence);
    if (!errors.confidence && confidence !== undefined && (confidence <= 0 || confidence > 100)) {
      errors.confidence = "Confidence runs from just above 0% to 100%.";
    }
    const effort = toNumber(draft.effort);
    if (effort !== undefined && effort < RICE_EFFORT_MIN) {
      errors.effort = "Effort is at least 0.5 person-months.";
    }
    return toValidation(draft, errors);
  },
  evaluate(v) {
    const r = read(v);
    const missing = missingKeys(INPUTS, r);
    const effort = r.effort as number | undefined;
    // An effort of 0 can't be divided by: Not scored, never a floor.
    if (effort !== undefined && effort <= 0) missing.push("effort");
    if (missing.length > 0) return notScored(missing);
    const values = r as unknown as RiceValues;
    const score = riceScore(values);
    const below = values.effort < RICE_EFFORT_MIN;
    return {
      score,
      bucket: null,
      sortKey: score,
      missing: [],
      warnings: below
        ? [`Effort ${values.effort} is below the 0.5 minimum and counts as 0.5. Edit it.`]
        : [],
      extra: {
        reachPerQuarter: reachPerQuarter(values.reach, values.reachPeriod),
        effortBelowMinimum: below,
      },
    };
  },
  format: (score) => formatNumber(score, 1),
  owns: ["reach", "reachPeriod", "impact", "confidence", "effort"],
  fromBacklog(item) {
    const r = readBacklogItem(item);
    return {
      reach: r.reach,
      reachPeriod: r.reachPeriod ?? LEGACY_REACH_PERIOD,
      impact: r.impact,
      confidence: r.confidence,
      effort: r.effort,
    };
  },
  toBacklog: (v) =>
    defined({
      reach: toNumber(v.reach),
      reachPeriod: toChoice(REACH_PERIODS, v.reachPeriod),
      impact: toNumber(v.impact),
      confidence: toNumber(v.confidence),
      effort: toNumber(v.effort),
    }),
};
