/**
 * WSJF (Weighted Shortest Job First, SAFe):
 * (business value + time criticality + risk reduction / opportunity
 * enablement) ÷ job size.
 *
 * Every part is on the modified Fibonacci scale 1, 2, 3, 5, 8, 13, 20,
 * sized relative to the other items, in the tool, the hub and the agent
 * actions alike (nothing clamps to 10). The job size floor is 1, the
 * bottom of the scale: a legacy 0 < size < 1 scores as 1 (shown as
 * Custom); a size of 0 or none is Not scored. An off-scale stored value is
 * kept as it is and shown as Custom, never snapped.
 */

import type { BacklogItem } from "@/lib/stores/workspace-types";
import { readBacklogItem } from "../defaults";
import { FIBONACCI_STEPS } from "./fibonacci";
import {
  defined,
  inputErrors,
  missingKeys,
  notScored,
  put,
  toNumber,
  toValidation,
} from "./fields";
import type { MethodInput, PrioritizationMethod, RowFields, Values } from "./types";

export { FIBONACCI_STEPS, FIBONACCI_VALUES, fibonacciAtOrAbove } from "./fibonacci";

/** The four parts, by their row keys (risk reduction is `rrOe` on a row, `riskReduction` on an item). */
export const WSJF_KEYS = ["businessValue", "timeCriticality", "rrOe", "jobSize"] as const;
export type WsjfKey = (typeof WSJF_KEYS)[number];
export type WsjfValues = Record<WsjfKey, number>;

/** The smallest job size a score divides by: the bottom of the Fibonacci scale. */
export const WSJF_JOB_SIZE_MIN = 1;

export const WSJF_LABEL: Record<WsjfKey, string> = {
  businessValue: "Business value",
  timeCriticality: "Time criticality",
  rrOe: "Risk reduction / opportunity enablement",
  jobSize: "Job size",
};

const HINT: Record<WsjfKey, string> = {
  businessValue: "Value to users or the business, against the other items.",
  timeCriticality: "How fast the value drops if it waits.",
  rrOe: "Risk it removes or options it opens.",
  jobSize: "Work it takes, relative to the others.",
};

const MISSING: Record<WsjfKey, string> = {
  businessValue: "Pick a business value.",
  timeCriticality: "Pick a time criticality.",
  rrOe: "Pick a risk reduction score.",
  jobSize: "Pick a job size.",
};

const BACKLOG_KEY: Record<WsjfKey, keyof BacklogItem> = {
  businessValue: "businessValue",
  timeCriticality: "timeCriticality",
  rrOe: "riskReduction",
  jobSize: "jobSize",
};

/** One line for the form: score each part against the others. */
export const WSJF_LEGEND =
  "Score each item against the others: 1 is the smallest in the set, 3 to 8 in between, 13 and 20 the largest.";

const INPUTS: readonly MethodInput[] = WSJF_KEYS.map((key) => ({
  key,
  kind: "scale" as const,
  label: WSJF_LABEL[key],
  hint: HINT[key],
  missing: MISSING[key],
  backlogKey: BACKLOG_KEY[key],
  steps: FIBONACCI_STEPS,
}));

/**
 * WSJF of four set parts, unrounded. The value parts count from 0; the job
 * size divides at least by 1.
 */
export function wsjfScore(v: WsjfValues): number {
  const cod = Math.max(0, v.businessValue) + Math.max(0, v.timeCriticality) + Math.max(0, v.rrOe);
  return cod / Math.max(WSJF_JOB_SIZE_MIN, v.jobSize);
}

/**
 * The relative hint: the columns with at least two scored values where no
 * item has a 1 ("give the smallest a 1 and size the others against it").
 */
export function columnsWithoutOne(values: readonly Values[]): WsjfKey[] {
  return WSJF_KEYS.filter((key) => {
    const set = values.map((v) => toNumber(v[key])).filter((n): n is number => n !== undefined);
    return set.length >= 2 && !set.includes(1);
  });
}

function read(fields: Values | undefined): Values {
  const out: Values = {};
  for (const key of WSJF_KEYS) out[key] = toNumber(fields?.[key]);
  return out;
}

function write(fields: RowFields | undefined, v: Values): RowFields {
  const out: RowFields = { ...fields };
  for (const key of WSJF_KEYS) put(out, key, toNumber(v[key]));
  return out;
}

export const WSJF: PrioritizationMethod = {
  id: "wsjf",
  toolId: "wsjf",
  label: "WSJF",
  embedded: true,
  inputs: INPUTS,
  read,
  write,
  validate(draft) {
    const errors = inputErrors(INPUTS, draft);
    for (const key of WSJF_KEYS) {
      const n = toNumber(draft[key]);
      if (errors[key] || n === undefined) continue;
      if (key === "jobSize" ? n <= 0 : n < 0) {
        errors[key] =
          key === "jobSize" ? "Job size is more than 0." : `${WSJF_LABEL[key]} is 0 or more.`;
      }
    }
    return toValidation(draft, errors);
  },
  evaluate(v) {
    const parts = read(v);
    const missing = missingKeys(INPUTS, parts);
    const size = parts.jobSize as number | undefined;
    // A job size of 0 can't be divided by: Not scored, never a floor.
    if (size !== undefined && size <= 0) missing.push("jobSize");
    if (missing.length > 0) return notScored(missing);
    const values = parts as WsjfValues;
    const score = wsjfScore(values);
    const warnings =
      values.jobSize < WSJF_JOB_SIZE_MIN
        ? [`Job size ${values.jobSize} is below 1, the smallest on the scale: it counts as 1.`]
        : [];
    return {
      score,
      bucket: null,
      sortKey: score,
      missing: [],
      warnings,
      extra: {
        costOfDelay:
          Math.max(0, values.businessValue) +
          Math.max(0, values.timeCriticality) +
          Math.max(0, values.rrOe),
      },
    };
  },
  // Two decimal places always ("8.00"), as WSJF has always read on the hub.
  format: (score) => (Number.isFinite(score) ? score.toFixed(2) : "—"),
  owns: ["businessValue", "timeCriticality", "riskReduction", "jobSize"],
  fromBacklog(item) {
    const r = readBacklogItem(item);
    return {
      businessValue: r.businessValue,
      timeCriticality: r.timeCriticality,
      rrOe: r.riskReduction,
      jobSize: r.jobSize,
    };
  },
  toBacklog: (v) =>
    defined({
      businessValue: toNumber(v.businessValue),
      timeCriticality: toNumber(v.timeCriticality),
      riskReduction: toNumber(v.rrOe),
      jobSize: toNumber(v.jobSize),
    }),
};
