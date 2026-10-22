/**
 * LLM evaluation regression detection.
 *
 * Two complementary checks:
 *
 *   1. Two-sample mean shift between consecutive windows of eval scores
 *      using Welch's t-statistic — flags when a model upgrade or prompt
 *      change has measurably moved accuracy.
 *
 *   2. Per-prompt drift: for any (prompt, dataset) pair, compare the
 *      most recent score against the rolling baseline (mean - k*std)
 *      and flag if the latest run breaches the lower bound.
 *
 * Both return null when there's not enough data to make a confident
 * call, which the caller renders as "more data needed."
 */

export interface EvalSample {
  /** Identifier you want to group by, e.g. `${prompt}|${dataset}`. */
  group: string;
  /** 0..1 metric — accuracy, faithfulness, relevance, etc. */
  score: number;
  recordedAt: string; // ISO timestamp
}

export interface RegressionFinding {
  group: string;
  baselineMean: number;
  recentMean: number;
  /** delta in the metric units (recent - baseline). Negative is bad. */
  delta: number;
  /** Welch t-statistic (absolute). Higher = more confident. */
  tStat: number;
  /** Approx. 0..1 significance, 1 = highly likely real. */
  confidence: number;
  baselineN: number;
  recentN: number;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}

/**
 * Welch's t-test for unequal variances. Returns the absolute t-stat.
 * We don't bother with p-value tables — the caller bins t into a
 * coarse confidence band that's good enough for UI display.
 */
function welchT(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a);
  const vb = variance(b);
  const se = Math.sqrt(va / a.length + vb / b.length);
  // Two constant windows (1,1,1 → 0.5,0.5,0.5) are perfectly separated, not
  // "no evidence": their t is unbounded unless the means are equal.
  if (se === 0) return ma === mb ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(ma - mb) / se;
}

/** recordedAt as epoch ms; an unparseable timestamp sorts as the oldest
 *  (raw NaN made the comparator non-transitive and scrambled the windows). */
function recordedMs(s: EvalSample): number {
  const t = new Date(s.recordedAt).getTime();
  return Number.isFinite(t) ? t : Number.MIN_SAFE_INTEGER;
}

/** Map an absolute t-stat to a 0..1 confidence band. */
function tToConfidence(t: number): number {
  if (t < 1) return 0.05;
  if (t < 1.5) return 0.2;
  if (t < 2) return 0.5;
  if (t < 2.5) return 0.7;
  if (t < 3) return 0.85;
  if (t < 4) return 0.95;
  return 0.99;
}

export interface RegressionOptions {
  /** Min samples per side to report a finding. Default 3. */
  minSamples?: number;
  /** Window size for the "recent" side. Default 3. */
  recentWindow?: number;
  /** Confidence threshold (0..1). Default 0.7 — t≈2.5+. */
  minConfidence?: number;
}

/**
 * Find groups whose most recent N samples have a statistically
 * lower mean than the baseline (everything before the recent window).
 * Returns one finding per regressed group, sorted by largest negative
 * delta first.
 */
export function detectRegressions(
  samples: EvalSample[],
  opts: RegressionOptions = {}
): RegressionFinding[] {
  const minSamples = opts.minSamples ?? 3;
  const recentWindow = opts.recentWindow ?? 3;
  const minConfidence = opts.minConfidence ?? 0.7;

  const byGroup = new Map<string, EvalSample[]>();
  for (const s of samples) {
    const arr = byGroup.get(s.group) ?? [];
    arr.push(s);
    byGroup.set(s.group, arr);
  }

  const findings: RegressionFinding[] = [];
  for (const [group, list] of Array.from(byGroup.entries())) {
    if (list.length < minSamples * 2) continue;
    const sorted = [...list].sort((a, b) => recordedMs(a) - recordedMs(b));
    const recent = sorted.slice(-recentWindow);
    const baseline = sorted.slice(0, sorted.length - recentWindow);
    if (baseline.length < minSamples || recent.length < minSamples) continue;

    const aScores = baseline.map((s) => s.score);
    const bScores = recent.map((s) => s.score);
    const baselineMean = mean(aScores);
    const recentMean = mean(bScores);
    const delta = recentMean - baselineMean;
    if (delta >= 0) continue; // only report regressions

    const t = welchT(aScores, bScores);
    const confidence = tToConfidence(t);
    if (confidence < minConfidence) continue;

    findings.push({
      group,
      baselineMean,
      recentMean,
      delta,
      tStat: t,
      confidence,
      baselineN: baseline.length,
      recentN: recent.length,
    });
  }

  findings.sort((a, b) => a.delta - b.delta); // most-negative first
  return findings;
}

/**
 * Compute the rolling-mean baseline for a single group, returning the
 * lower bound (mean - k * std) used to gate "is this run a drop?"
 * Returns null if there aren't enough samples to form a baseline.
 */
export function rollingLowerBound(scores: number[], k = 2): number | null {
  if (scores.length < 4) return null;
  const m = mean(scores);
  const v = variance(scores);
  return m - k * Math.sqrt(v);
}
