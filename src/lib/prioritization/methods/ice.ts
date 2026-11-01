/**
 * ICE: impact × confidence × ease, each 1–10 (a score of 1–1000). A quick
 * gut-check for experiments.
 *
 * The backlog holds no ICE inputs: a linked row is the source, and the
 * hub shows the latest linked row's score. A stored value off the 1–10
 * scale is kept as it is (shown as Custom) and the score holds it to 1–10.
 */

import {
  formatNumber,
  inputErrors,
  missingKeys,
  notScored,
  put,
  toNumber,
  toValidation,
} from "./fields";
import type { MethodInput, PrioritizationMethod, RowFields, ScaleStep, Values } from "./types";

/** A 1–10 scale with what each value means (the option's tooltip). */
const scale = (meanings: readonly string[]): readonly ScaleStep[] =>
  meanings.map((meaning, i) => ({ value: i + 1, meaning }));

/** How much the idea moves the goal if it works. */
export const ICE_IMPACT_STEPS = scale([
  "Barely noticeable",
  "Very small",
  "Small",
  "Modest",
  "A clear improvement",
  "Solid",
  "Big",
  "Very big",
  "Major",
  "Changes the game for the goal",
]);

/** How sure the team is about the impact and the ease. */
export const ICE_CONFIDENCE_STEPS = scale([
  "A hunch",
  "A hunch the team shares",
  "A few anecdotes",
  "Some user feedback",
  "Data points or interviews",
  "Several sources agree",
  "Market or usage data",
  "A tested prototype",
  "Experiment results",
  "Proven in an earlier launch",
]);

/** How little effort it takes: 10 is under a day, 1 is months across teams. */
export const ICE_EASE_STEPS = scale([
  "Months of work across teams",
  "About a quarter",
  "More than a month",
  "About a month",
  "Two to three weeks",
  "About two weeks",
  "About a week",
  "A few days",
  "A day or two",
  "Under a day",
]);

export const ICE_KEYS = ["impact", "confidence", "ease"] as const;
export type IceKey = (typeof ICE_KEYS)[number];

export const ICE_STEPS: Record<IceKey, readonly ScaleStep[]> = {
  impact: ICE_IMPACT_STEPS,
  confidence: ICE_CONFIDENCE_STEPS,
  ease: ICE_EASE_STEPS,
};

const LABEL: Record<IceKey, string> = { impact: "Impact", confidence: "Confidence", ease: "Ease" };

const HINT: Record<IceKey, string> = {
  impact: "1 barely noticeable · 5 a clear improvement · 10 changes the game for the goal.",
  confidence: "1 a hunch · 5 data points or interviews · 10 proven in an earlier launch.",
  ease: "1 months across teams · 5 two to three weeks · 10 under a day.",
};

const MISSING: Record<IceKey, string> = {
  impact: "Pick an impact score.",
  confidence: "Pick a confidence score.",
  ease: "Pick an ease score.",
};

const INPUTS: readonly MethodInput[] = ICE_KEYS.map((key) => ({
  key,
  kind: "scale" as const,
  label: LABEL[key],
  hint: HINT[key],
  missing: MISSING[key],
  steps: ICE_STEPS[key],
}));

const clamp10 = (n: number) => Math.min(10, Math.max(1, n));

/** ICE of three set inputs, each held to 1–10. */
export function iceScore(v: Record<IceKey, number>): number {
  return clamp10(v.impact) * clamp10(v.confidence) * clamp10(v.ease);
}

function read(fields: Values | undefined): Values {
  return {
    impact: toNumber(fields?.impact),
    confidence: toNumber(fields?.confidence),
    ease: toNumber(fields?.ease),
  };
}

function write(fields: RowFields | undefined, v: Values): RowFields {
  const out: RowFields = { ...fields };
  for (const key of ICE_KEYS) put(out, key, toNumber(v[key]));
  return out;
}

export const ICE: PrioritizationMethod = {
  id: "ice",
  toolId: "ice-score",
  label: "ICE",
  embedded: false,
  inputs: INPUTS,
  read,
  write,
  validate(draft) {
    const errors = inputErrors(INPUTS, draft);
    for (const key of ICE_KEYS) {
      const n = toNumber(draft[key]);
      if (!errors[key] && n !== undefined && (n < 1 || n > 10)) {
        errors[key] = `${LABEL[key]} runs from 1 to 10.`;
      }
    }
    return toValidation(draft, errors);
  },
  evaluate(v) {
    const r = read(v);
    const missing = missingKeys(INPUTS, r);
    if (missing.length > 0) return notScored(missing);
    const score = iceScore(r as Record<IceKey, number>);
    return { score, bucket: null, sortKey: score, missing: [], warnings: [] };
  },
  format: (score) => formatNumber(score, 2),
};
