/**
 * Conversion A/B tests: how many people each version needs, how long that
 * takes, the smallest change a sample can find, and the reading of a
 * result: each version's rate with a Wilson interval, B against A as a
 * difference (Newcombe's hybrid score interval) and as a lift (Katz's log
 * interval), the pooled z test, and a check that the split between the
 * two is as even as planned.
 *
 * Every rate is a fraction (0.1 is 10%). The sample size is R's
 * `power.prop.test` (pooled under the null, the other tail ignored), so
 * 10% → 12% at 95% and 80% power needs 3,841 a version. A one-sided plan
 * reads the one-sided p for "B is better", with its intervals two-sided at
 * 1 − 2α, so the interval and the p value always agree.
 *
 * Pure: imports only the normal distribution.
 */

import { chiSquareSf1, normalQuantile, normalSf } from "@/lib/analytics/distributions";

export type TestSided = "two" | "one";
export type MdeMode = "relative" | "absolute";

/** What a sample size needs: every rate a fraction, confidence and power too. */
export interface ConversionPlan {
  /** The current conversion rate, in (0, 1). */
  baseline: number;
  /** The smallest change worth finding: a share of the baseline (relative) or points (absolute). */
  mde: number;
  mdeMode: MdeMode;
  /** 0.90, 0.95 or 0.99. */
  confidence: number;
  /** 0.8 or 0.9. */
  power: number;
  sided: TestSided;
}

/** The chance of calling a difference that isn't there: 1 − confidence. */
export const alphaOf = (confidence: number) => 1 - confidence;

/** The z a test compares with: q(1 − α/2) two-sided, q(1 − α) one-sided. */
export function criticalZ(confidence: number, sided: TestSided): number {
  const alpha = alphaOf(confidence);
  return normalQuantile(sided === "two" ? 1 - alpha / 2 : 1 - alpha);
}

/**
 * The two-sided level of the intervals a test reports: the confidence for
 * a two-sided test, 1 − 2α for a one-sided one (95% one-sided reads a 90%
 * interval, whose lower end is the one-sided bound).
 */
export const intervalLevel = (confidence: number, sided: TestSided) =>
  sided === "two" ? confidence : 1 - 2 * alphaOf(confidence);

/** B's rate under the plan: the baseline moved by the smallest change worth finding. */
export function treatmentRate(plan: Pick<ConversionPlan, "baseline" | "mde" | "mdeMode">): number {
  return plan.mdeMode === "relative" ? plan.baseline * (1 + plan.mde) : plan.baseline + plan.mde;
}

const inOpenUnit = (p: number) => Number.isFinite(p) && p > 0 && p < 1;

/** n per version for rates p1 and p2: the pooled-under-null formula. */
function sizeFor(p1: number, p2: number, confidence: number, power: number, sided: TestSided) {
  const za = criticalZ(confidence, sided);
  const zb = normalQuantile(power);
  const pbar = (p1 + p2) / 2;
  const top = za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return (top * top) / ((p2 - p1) * (p2 - p1));
}

/**
 * People each version needs, unrounded (R's power.prop.test): 3,840.85 for
 * 10% → 12% at 95% two-sided and 80% power. A RangeError when the baseline
 * or B's rate isn't strictly between 0 and 1, or the change is nothing.
 */
export function sampleSizeConversion(plan: ConversionPlan): number {
  const p1 = plan.baseline;
  const p2 = treatmentRate(plan);
  if (!inOpenUnit(p1)) throw new RangeError("The current rate must be between 0 and 1.");
  if (!inOpenUnit(p2)) throw new RangeError("The rate with the change must be between 0 and 1.");
  if (p2 === p1) throw new RangeError("The smallest change worth finding can't be nothing.");
  if (!(plan.power > 0 && plan.power < 1)) throw new RangeError("Power must be between 0 and 1.");
  if (!(plan.confidence > 0 && plan.confidence < 1)) {
    throw new RangeError("Confidence must be between 0 and 1.");
  }
  return sizeFor(p1, p2, plan.confidence, plan.power, plan.sided);
}

/** People each version needs, whole (rounded up). */
export const perVariantSize = (plan: ConversionPlan) => Math.ceil(sampleSizeConversion(plan));

export interface RunLength {
  /** Days at the daily traffic, every version together. */
  days: number;
  /** Whole weeks: run whole weeks, so weekdays and weekends both count. */
  weeks: number;
}

/** How long a test takes at `dailyTraffic` visitors a day, split over `variants`. Null without traffic. */
export function runLength(
  perVariant: number,
  dailyTraffic: number | undefined,
  variants = 2
): RunLength | null {
  if (!(typeof dailyTraffic === "number" && dailyTraffic > 0) || !(perVariant > 0)) return null;
  const days = Math.ceil((perVariant * variants) / dailyTraffic);
  return { days, weeks: Math.ceil(days / 7) };
}

/**
 * The smallest rise in points (a fraction: 0.02 is 2 points) a sample of `n`
 * a version can find from `baseline`, by bisection on the sample size.
 * Null when even the largest possible rise needs more people.
 */
export function detectableEffect(
  baseline: number,
  n: number,
  opts: Pick<ConversionPlan, "confidence" | "power" | "sided">
): number | null {
  if (!inOpenUnit(baseline) || !(n >= 2) || !Number.isFinite(n)) return null;
  const size = (d: number) =>
    sizeFor(baseline, baseline + d, opts.confidence, opts.power, opts.sided);
  let hi = (1 - baseline) * (1 - 1e-9);
  if (size(hi) > n) return null;
  let lo = 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (size(mid) <= n) hi = mid;
    else lo = mid;
  }
  return hi;
}

/* ── Reading a result ────────────────────────────────────────────────── */

export interface Counts {
  visitors: number;
  conversions: number;
}

export type Interval = readonly [number, number];

/** Wilson's score interval for x of n at critical value z, inside [0, 1]. */
export function wilsonInterval(x: number, n: number, z: number): Interval {
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Newcombe's hybrid score interval for p1 − p2 (his method 10), from each
 * rate's Wilson interval: good at small counts and rates near 0 or 1,
 * where the plain Wald interval isn't.
 */
export function newcombeInterval(one: Counts, two: Counts, z: number): Interval {
  const p1 = one.conversions / one.visitors;
  const p2 = two.conversions / two.visitors;
  const [l1, u1] = wilsonInterval(one.conversions, one.visitors, z);
  const [l2, u2] = wilsonInterval(two.conversions, two.visitors, z);
  const d = p1 - p2;
  return [
    d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2),
    d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2),
  ];
}

/** p1 / p2 with Katz's log interval; null when either version converted nobody. */
export function katzInterval(
  one: Counts,
  two: Counts,
  z: number
): { ratio: number; interval: Interval } | null {
  if (one.conversions <= 0 || two.conversions <= 0) return null;
  const ratio = one.conversions / one.visitors / (two.conversions / two.visitors);
  const se = Math.sqrt(
    1 / one.conversions - 1 / one.visitors + 1 / two.conversions - 1 / two.visitors
  );
  return { ratio, interval: [ratio * Math.exp(-z * se), ratio * Math.exp(z * se)] };
}

/** The pooled two-proportion z for B against A (positive: B converts better). */
export function pooledZ(a: Counts, b: Counts): number {
  const pooled = (a.conversions + b.conversions) / (a.visitors + b.visitors);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.visitors + 1 / b.visitors));
  if (!(se > 0)) return 0;
  return (b.conversions / b.visitors - a.conversions / a.visitors) / se;
}

/** Where the planned even split is checked: a p below this says the setup may be off. */
export const SPLIT_FLAG_P = 0.001;

export interface SplitCheck {
  chiSquare: number;
  p: number;
  /** p below SPLIT_FLAG_P: check the setup before trusting the result. */
  flagged: boolean;
}

/** A chi-square test of the visitors against the planned even split. */
export function splitCheck(a: Counts, b: Counts): SplitCheck {
  const expected = (a.visitors + b.visitors) / 2;
  const chiSquare =
    expected > 0 ? ((a.visitors - expected) ** 2 + (b.visitors - expected) ** 2) / expected : 0;
  const p = chiSquareSf1(chiSquare);
  return { chiSquare, p, flagged: p < SPLIT_FLAG_P };
}

export interface VariantReading extends Counts {
  rate: number;
  interval: Interval;
}

export interface ConversionAnalysis {
  a: VariantReading;
  b: VariantReading;
  /** B's rate − A's, a fraction (0.02 is +2 points), with Newcombe's interval. */
  difference: number;
  differenceInterval: Interval;
  /** B's rate ÷ A's − 1 (0.2 is +20%), with Katz's interval; null when a version converted nobody. */
  lift: number | null;
  liftInterval: Interval | null;
  z: number;
  /** Two-sided, or one-sided for "B is better" on a one-sided plan. */
  p: number;
  sided: TestSided;
  confidence: number;
  /** The two-sided level of every interval here (see intervalLevel). */
  level: number;
  /** p below 1 − confidence. */
  significant: boolean;
  split: SplitCheck;
}

const checkCounts = (c: Counts, name: string) => {
  if (!Number.isInteger(c.visitors) || c.visitors < 1) {
    throw new RangeError(`${name} needs at least one visitor, as a whole number.`);
  }
  if (!Number.isInteger(c.conversions) || c.conversions < 0 || c.conversions > c.visitors) {
    throw new RangeError(`${name}'s conversions must be a whole number from 0 to its visitors.`);
  }
};

/**
 * B against A at the plan's confidence and sides. A RangeError when a
 * version has no visitors, or counts that aren't whole or don't fit.
 */
export function analyzeConversion(
  a: Counts,
  b: Counts,
  opts: { confidence: number; sided: TestSided }
): ConversionAnalysis {
  checkCounts(a, "A");
  checkCounts(b, "B");
  const level = intervalLevel(opts.confidence, opts.sided);
  const zi = normalQuantile(1 - (1 - level) / 2);
  const reading = (c: Counts): VariantReading => ({
    ...c,
    rate: c.conversions / c.visitors,
    interval: wilsonInterval(c.conversions, c.visitors, zi),
  });
  const ra = reading(a);
  const rb = reading(b);
  const katz = katzInterval(b, a, zi);
  const z = pooledZ(a, b);
  const p = opts.sided === "two" ? Math.min(1, 2 * normalSf(Math.abs(z))) : normalSf(z);
  return {
    a: ra,
    b: rb,
    difference: rb.rate - ra.rate,
    differenceInterval: newcombeInterval(b, a, zi),
    lift: katz ? katz.ratio - 1 : null,
    liftInterval: katz ? [katz.interval[0] - 1, katz.interval[1] - 1] : null,
    z,
    p,
    sided: opts.sided,
    confidence: opts.confidence,
    level,
    significant: p < alphaOf(opts.confidence),
    split: splitCheck(a, b),
  };
}

/* ── In words ────────────────────────────────────────────────────────── */

const MINUS = "−";

/** A whole percentage: "95%". */
export const percentText = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

/** Points with a sign and one decimal: "+2.0", "−1.3", "0.0". */
export function pointsText(fraction: number): string {
  const v = Math.round(fraction * 1000) / 10;
  if (v === 0) return "0.0";
  return `${v > 0 ? "+" : MINUS}${Math.abs(v).toFixed(1)}`;
}

/** A lift with a sign and one decimal: "+19.8%". */
export const liftText = (fraction: number) => `${pointsText(fraction)}%`;

/** A rate as a percentage with one decimal: "12.0%". */
export const rateText = (fraction: number) => `${(Math.round(fraction * 1000) / 10).toFixed(1)}%`;

/** A p value as people read it: "0.0045", "0.43", "< 0.0001". */
export function pText(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.0001) return "< 0.0001";
  return String(Number(p.toPrecision(2)));
}

/**
 * The result in one sentence, in fixed words. It never says how likely it
 * is that B is better: a p value isn't that.
 *   "B converted better than A by 2.0 points (95% interval +0.6 to +3.4 points; p = 0.0045), significant at 95% confidence."
 */
export function resultSentence(r: ConversionAnalysis): string {
  const level = percentText(r.level);
  const [lo, hi] = r.differenceInterval;
  const pLabel = r.sided === "one" ? "one-sided p" : "p";
  const pPart = r.p < 0.0001 ? `${pLabel} < 0.0001` : `${pLabel} = ${pText(r.p)}`;
  const detail = `(${level} interval ${pointsText(lo)} to ${pointsText(hi)} points; ${pPart})`;
  const conf = percentText(r.confidence);
  const size = Math.abs(Math.round(r.difference * 1000) / 10).toFixed(1);
  if (r.significant && r.difference > 0) {
    return `B converted better than A by ${size} points ${detail}, significant at ${conf} confidence.`;
  }
  if (r.significant && r.difference < 0) {
    return `B converted worse than A by ${size} points ${detail}, significant at ${conf} confidence.`;
  }
  if (r.sided === "one") {
    return `B isn't shown to convert better than A: ${pointsText(r.difference)} points ${detail}, not significant at ${conf} confidence.`;
  }
  return `No clear difference between A and B: ${pointsText(r.difference)} points ${detail}, not significant at ${conf} confidence.`;
}

/** "How to read this", in two fixed lines. */
export const HOW_TO_READ = [
  "A confidence interval is the range of effects these numbers fit.",
  "p is how often a difference this big or bigger would turn up if A and B were really the same.",
] as const;
