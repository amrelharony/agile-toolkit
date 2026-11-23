/**
 * The A/B Calculator's rules on top of the maths in ./ab: the plan and
 * count forms as typed (percentages in, fractions stored), a plan's size
 * and length, the early-look rule, and a saved test read as the page and
 * tool.ab_calculator read it.
 *
 * The early-look rule: below the planned sample (the smaller version
 * counts) the verdict reads "Too early to call", because reading a test
 * before its sample is in and stopping when it first looks good inflates
 * false wins. The numbers still show. With no plan, the verdict shows with
 * a note to decide the sample first next time.
 *
 * Pure and server-safe: no React, no store, no "use client" module.
 */

import type {
  AbDecision,
  AbTest,
  AbTestPlan,
  AbTestStatus,
  AbVariant,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { isBlank, parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import {
  analyzeConversion,
  detectableEffect,
  perVariantSize,
  resultSentence,
  runLength,
  treatmentRate,
  type ConversionAnalysis,
  type MdeMode,
  type RunLength,
  type TestSided,
} from "./ab";

/** The confidence levels a plan offers. */
export const PLAN_CONFIDENCES = [0.9, 0.95, 0.99] as const;
/** The power levels a plan offers. */
export const PLAN_POWERS = [0.8, 0.9] as const;
/** The most visitors or conversions a version takes, and the most visitors a day. */
export const COUNT_MAX = 1_000_000_000;
/** Past this many people a version, the plan says to pick a bigger effect. */
export const TOO_BIG_PER_VARIANT = 100_000_000;
/** The weeks the "smallest effect you could find" table runs over. */
export const EFFECT_WEEKS = [1, 2, 3, 4] as const;

export const STATUS_LABEL: Record<AbTestStatus, string> = {
  planned: "Planned",
  running: "Running",
  done: "Done",
};

export const DECISION_LABEL: Record<AbDecision, string> = {
  ship: "Ship B",
  keep: "Keep A",
  rerun: "Run it again",
};

/** The control and B, as every new test names them. */
export const VARIANT_IDS = ["a", "b"] as const;

const round = (n: number, digits = 10) => Math.round(n * 10 ** digits) / 10 ** digits;

/** "3,841": a whole number with thousands marks. */
export const countText = (n: number) => Math.round(n).toLocaleString("en-US");

/* ── The plan form ───────────────────────────────────────────────────── */

/** The plan as typed: rates in percent, the change in percent or points. */
export interface PlanDraft {
  /** The current conversion rate, in percent ("10"). */
  baselinePct: string;
  /** The smallest change worth finding: percent of the baseline (relative) or points (absolute). */
  mde: string;
  mdeMode: MdeMode;
  confidence: number;
  power: number;
  sided: TestSided;
  /** Visitors a day, both versions together (optional). */
  dailyTraffic: string;
}

export type PlanField = keyof PlanDraft;

/** A blank plan: 95% confidence, 80% power, two-sided, a relative change. */
export function emptyPlanDraft(): PlanDraft {
  return {
    baselinePct: "",
    mde: "",
    mdeMode: "relative",
    confidence: 0.95,
    power: 0.8,
    sided: "two",
    dailyTraffic: "",
  };
}

/** The form for a stored plan. */
export function planDraftFrom(plan: AbTestPlan): PlanDraft {
  return {
    baselinePct: String(round(plan.baseline * 100, 6)),
    mde: String(round(plan.mde * 100, 6)),
    mdeMode: plan.mdeMode,
    confidence: plan.confidence,
    power: plan.power,
    sided: plan.sided,
    dailyTraffic:
      typeof plan.dailyTraffic === "number" && plan.dailyTraffic > 0
        ? String(plan.dailyTraffic)
        : "",
  };
}

/** A whole number as people type it: "3,841", " 10 ". */
const typedNumber = (raw: string) => parseNumber(raw.replace(/[\s,_%]/g, ""));

/**
 * A rate or a change as people type it: "2.5", "12 %", and "2,5" from a
 * phone whose decimal key is a comma, so it reads 2.5, never 25. A lone
 * comma is the decimal point; a comma next to a point, or a second one,
 * doesn't read as a number.
 */
const typedRate = (raw: string) => {
  const s = raw.replace(/[\s_%]/g, "");
  return parseNumber(/^[^.,]*,[^.,]*$/.test(s) ? s.replace(",", ".") : s);
};

/**
 * Check the plan form. The current rate is above 0 and below 100%, the
 * change is above nothing and keeps B's rate below 100%, confidence and
 * power are ones the page offers, and visitors a day (optional) are a
 * whole number. Rates are stored as fractions.
 */
export function validatePlan(d: PlanDraft): Validation<AbTestPlan, PlanField> {
  const errors: FormErrors<PlanField> = {};
  const baselinePct = typedRate(d.baselinePct);
  const mde = typedRate(d.mde);
  if (baselinePct === undefined) errors.baselinePct = "Enter the current conversion rate.";
  else if (!Number.isFinite(baselinePct) || baselinePct <= 0 || baselinePct >= 100) {
    errors.baselinePct = "Enter a rate above 0 and below 100%.";
  }
  if (mde === undefined) errors.mde = "Enter the smallest change worth finding.";
  else if (!Number.isFinite(mde) || mde <= 0) errors.mde = "Enter a change above 0.";
  if (!(PLAN_CONFIDENCES as readonly number[]).includes(d.confidence)) {
    errors.confidence = "Pick 90, 95 or 99%.";
  }
  if (!(PLAN_POWERS as readonly number[]).includes(d.power)) errors.power = "Pick 80 or 90%.";
  if (d.mdeMode !== "relative" && d.mdeMode !== "absolute")
    errors.mdeMode = "Pick how to count it.";
  if (d.sided !== "two" && d.sided !== "one") errors.sided = "Pick one- or two-sided.";
  const traffic = typedNumber(d.dailyTraffic);
  if (traffic !== undefined) {
    if (!Number.isInteger(traffic) || traffic < 1 || traffic > COUNT_MAX) {
      errors.dailyTraffic = "Enter visitors a day as a whole number, or leave it blank.";
    }
  }
  if (!errors.baselinePct && !errors.mde && !errors.mdeMode) {
    const b = (baselinePct as number) / 100;
    const m = (mde as number) / 100;
    const p2 = treatmentRate({ baseline: b, mde: m, mdeMode: d.mdeMode });
    if (!(p2 < 1)) {
      errors.mde = "That takes B's rate to 100% or more: pick a smaller change.";
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      baseline: round((baselinePct as number) / 100),
      mde: round((mde as number) / 100),
      mdeMode: d.mdeMode,
      confidence: d.confidence,
      power: d.power,
      sided: d.sided,
      ...(traffic !== undefined ? { dailyTraffic: traffic } : {}),
    },
  };
}

/** A plan's answer: the people each version needs, the total and how long it runs. */
export interface PlanResult {
  /** B's rate if the change is real. */
  treatment: number;
  perVariant: number;
  total: number;
  /** Null without visitors a day. */
  run: RunLength | null;
  /** More than TOO_BIG_PER_VARIANT a version: pick a bigger effect. */
  tooBig: boolean;
}

/** The plan sized, or null when it can't be (a rate outside 0–100%). */
export function planResult(plan: AbTestPlan): PlanResult | null {
  let perVariant: number;
  try {
    perVariant = perVariantSize(plan);
  } catch {
    return null;
  }
  return {
    treatment: treatmentRate(plan),
    perVariant,
    total: perVariant * 2,
    run: runLength(perVariant, plan.dailyTraffic),
    tooBig: perVariant > TOO_BIG_PER_VARIANT,
  };
}

/** One row of "the smallest effect you could find in N weeks". */
export interface EffectRow {
  weeks: number;
  perVariant: number;
  /** In points, a fraction (0.02 is 2 points); null when no rise is findable. */
  absolute: number | null;
  /** As a share of the baseline (0.2 is +20%); null with absolute. */
  relative: number | null;
}

/** The smallest effect the daily traffic could find in 1 to 4 weeks; [] without traffic. */
export function effectTable(plan: AbTestPlan): EffectRow[] {
  const daily = plan.dailyTraffic;
  if (!(typeof daily === "number" && daily > 0)) return [];
  return EFFECT_WEEKS.map((weeks) => {
    const perVariant = Math.floor((daily * 7 * weeks) / 2);
    const absolute = detectableEffect(plan.baseline, perVariant, plan);
    return {
      weeks,
      perVariant,
      absolute,
      relative: absolute === null ? null : absolute / plan.baseline,
    };
  });
}

/* ── The counts form ─────────────────────────────────────────────────── */

export interface CountsDraft {
  aVisitors: string;
  aConversions: string;
  bVisitors: string;
  bConversions: string;
}

export type CountsField = keyof CountsDraft;

export interface CountsValues {
  a: { visitors: number; conversions: number };
  b: { visitors: number; conversions: number };
}

export const emptyCountsDraft = (): CountsDraft => ({
  aVisitors: "",
  aConversions: "",
  bVisitors: "",
  bConversions: "",
});

/** The form for a stored test's counts ("" while a version has no visitors yet). */
export function countsDraftFrom(variants: readonly AbVariant[] | undefined): CountsDraft {
  const [a, b] = variants ?? [];
  const text = (v: AbVariant | undefined, key: "visitors" | "conversions") =>
    v && v.visitors > 0 ? String(v[key]) : "";
  return {
    aVisitors: text(a, "visitors"),
    aConversions: text(a, "conversions"),
    bVisitors: text(b, "visitors"),
    bConversions: text(b, "conversions"),
  };
}

/** Whether the counts form holds anything at all. */
export const countsTyped = (d: CountsDraft) =>
  !isBlank(d.aVisitors) ||
  !isBlank(d.aConversions) ||
  !isBlank(d.bVisitors) ||
  !isBlank(d.bConversions);

/**
 * Check the counts: whole numbers up to COUNT_MAX, at least one visitor a
 * version, conversions at most the visitors.
 */
export function validateCounts(d: CountsDraft): Validation<CountsValues, CountsField> {
  const errors: FormErrors<CountsField> = {};
  const read = (key: CountsField, visitors: boolean): number | undefined => {
    const n = typedNumber(d[key]);
    if (n === undefined) {
      errors[key] = visitors ? "Enter the visitors." : "Enter the conversions.";
      return undefined;
    }
    if (!Number.isInteger(n) || n < 0 || n > COUNT_MAX) {
      errors[key] = "Enter a whole number.";
      return undefined;
    }
    if (visitors && n < 1) {
      errors[key] = "Enter at least one visitor.";
      return undefined;
    }
    return n;
  };
  const av = read("aVisitors", true);
  const ac = read("aConversions", false);
  const bv = read("bVisitors", true);
  const bc = read("bConversions", false);
  if (av !== undefined && ac !== undefined && ac > av) {
    errors.aConversions = "Can't be more than A's visitors.";
  }
  if (bv !== undefined && bc !== undefined && bc > bv) {
    errors.bConversions = "Can't be more than B's visitors.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      a: { visitors: av as number, conversions: ac as number },
      b: { visitors: bv as number, conversions: bc as number },
    },
  };
}

/* ── Reading a result ────────────────────────────────────────────────── */

export interface EarlyLook {
  /** People a version the plan needs; null with no plan (or one that can't be sized). */
  planned: number | null;
  /** The smaller version's visitors: the one that decides. */
  smaller: number;
  /** The plan's sample is in. */
  met: boolean;
}

/** Whether the planned sample is in: the smaller version counts. */
export function earlyLook(
  plan: AbTestPlan | null | undefined,
  counts: CountsValues | null
): EarlyLook {
  const smaller = counts ? Math.min(counts.a.visitors, counts.b.visitors) : 0;
  const sized = plan ? planResult(plan) : null;
  const planned = sized?.perVariant ?? null;
  return { planned, smaller, met: planned !== null && smaller >= planned };
}

/** "Too early to call: 3,100 of 3,841 per variant". */
export const tooEarlyText = (e: EarlyLook) =>
  `Too early to call: ${countText(e.smaller)} of ${countText(e.planned ?? 0)} per variant`;

export const NO_PLAN_NOTE = "Decide the sample before you start next time.";
export const SPLIT_WARNING = "Check the setup before trusting this";

export interface ResultReading {
  analysis: ConversionAnalysis;
  early: EarlyLook;
  /** The result sentence, or "Too early to call: …" below the planned sample. */
  verdict: string;
  /** The result sentence, always (the numbers show even when it is too early). */
  sentence: string;
  /** With no plan: decide the sample first next time. */
  note: string | null;
  /** The split check failed: check the setup first. */
  splitWarning: string | null;
}

/**
 * The result as the page reads it, at the plan's confidence and sides (95%
 * two-sided without a plan). Null without counts.
 */
export function readResult(
  plan: AbTestPlan | null | undefined,
  counts: CountsValues | null
): ResultReading | null {
  if (!counts) return null;
  const analysis = analyzeConversion(counts.a, counts.b, {
    confidence: plan?.confidence ?? 0.95,
    sided: plan?.sided ?? "two",
  });
  const early = earlyLook(plan, counts);
  const sentence = resultSentence(analysis);
  const tooEarly = early.planned !== null && !early.met;
  return {
    analysis,
    early,
    verdict: tooEarly ? tooEarlyText(early) : sentence,
    sentence,
    note: plan && early.planned !== null ? null : NO_PLAN_NOTE,
    splitWarning: analysis.split.flagged
      ? `${SPLIT_WARNING}: the split between A and B is further from even than chance would make it.`
      : null,
  };
}

/* ── A saved test ────────────────────────────────────────────────────── */

/** A saved test's counts, once both versions have visitors. */
export function testCounts(t: Pick<AbTest, "variants">): CountsValues | null {
  const [a, b] = t.variants ?? [];
  if (!a || !b) return null;
  const ok = (v: AbVariant) =>
    Number.isInteger(v.visitors) &&
    v.visitors > 0 &&
    Number.isInteger(v.conversions) &&
    v.conversions >= 0 &&
    v.conversions <= v.visitors;
  if (!ok(a) || !ok(b)) return null;
  return {
    a: { visitors: a.visitors, conversions: a.conversions },
    b: { visitors: b.visitors, conversions: b.conversions },
  };
}

/** The two versions with these counts, keeping their ids and names. */
export function withCounts(
  variants: readonly AbVariant[] | undefined,
  counts: CountsValues | null
): AbVariant[] {
  const [a, b] = variants ?? [];
  const version = (v: AbVariant | undefined, id: string, name: string, c?: CountsValues["a"]) => ({
    id: v?.id ?? id,
    name: v?.name ?? name,
    visitors: c?.visitors ?? 0,
    conversions: c?.conversions ?? 0,
  });
  return [version(a, VARIANT_IDS[0], "A", counts?.a), version(b, VARIANT_IDS[1], "B", counts?.b)];
}

/** A saved test as the page and tool.ab_calculator read it. */
export interface TestSummary {
  plan: PlanResult | null;
  counts: CountsValues | null;
  result: ResultReading | null;
}

export function testSummary(t: AbTest): TestSummary {
  const counts = testCounts(t);
  let result: ResultReading | null = null;
  try {
    result = readResult(t.plan, counts);
  } catch {
    result = null;
  }
  return { plan: t.plan ? planResult(t.plan) : null, counts, result };
}

/** Whether a test's result can be used: its counts in and the plan's sample met. */
export const resultReady = (s: TestSummary) => Boolean(s.result && s.result.early.met);

/** Rows that read as tests: two versions and a plan. Anything else an agent wrote is left out. */
export function abTests(raw: readonly AbTest[] | undefined): AbTest[] {
  return (raw ?? []).filter(
    (t) =>
      t &&
      typeof t.id === "string" &&
      typeof t.name === "string" &&
      Array.isArray(t.variants) &&
      t.variants.length === 2 &&
      t.plan !== null &&
      typeof t.plan === "object"
  );
}

/** The team's own tests, or the example's while there are none. */
export function countedTests(list: readonly AbTest[]): { tests: AbTest[]; example: boolean } {
  const real = list.filter((t) => !isExampleId(t.id));
  if (real.length > 0 || list.length === 0) return { tests: real, example: false };
  return { tests: [...list], example: true };
}

/** The test that tests a hypothesis: the most recently updated one. */
export function testForHypothesis(
  tests: readonly AbTest[] | undefined,
  hypothesisId: string
): AbTest | undefined {
  return abTests(tests)
    .filter((t) => t.hypothesisId === hypothesisId)
    .sort((x, y) => (y.updatedAt ?? "").localeCompare(x.updatedAt ?? ""))[0];
}
