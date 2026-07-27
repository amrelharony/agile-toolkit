import { mean } from "./anomaly";

export interface ControlLimits {
  centerLine: number;
  ucl: number; // upper control limit
  lcl: number; // lower control limit
  type: "xmr" | "p-chart";
  /**
   * True (unclamped) 1σ half-width, when the chart knows it. p-chart limits
   * are clamped into [0,1], so `(ucl - centerLine) / 3` under-reports σ
   * whenever the clamp bites; consumers that need the real σ (the ±2σ zone
   * tests in `westernElectricRules`) must prefer this field.
   */
  sigma?: number;
}

export interface OutOfControlSignal {
  index: number;
  rule: "rule-1" | "rule-2" | "rule-3" | "rule-5";
  description: string;
}

/**
 * Individuals-and-moving-range (XmR / I-chart) control limits.
 * Uses the standard d2 = 1.128 conversion so UCL = X̄ + 2.66 · MR̄.
 * Designed for sprint-by-sprint metrics where each observation is a single
 * value (velocity, deploy frequency, MTTR).
 *
 * @param nonNegative  When true, clamps LCL at 0. Use only for metrics that
 *  genuinely cannot go below zero (counts, durations, WIP). For signed
 *  metrics like NPS delta or schedule variance, leave false (default) so
 *  real low-side excursions trigger Western-Electric Rule 1 instead of
 *  being silently swallowed by the clamp.
 */
export function xmrLimits(series: number[], nonNegative = false): ControlLimits {
  if (series.length < 2) {
    const c = series[0] ?? 0;
    return { centerLine: c, ucl: c, lcl: c, type: "xmr" };
  }
  const center = mean(series);
  // Moving ranges between consecutive observations.
  const mr: number[] = [];
  for (let i = 1; i < series.length; i++) mr.push(Math.abs(series[i] - series[i - 1]));
  const mrBar = mean(mr);
  const halfWidth = 2.66 * mrBar;
  const rawLcl = center - halfWidth;
  return {
    centerLine: center,
    ucl: center + halfWidth,
    lcl: nonNegative ? Math.max(0, rawLcl) : rawLcl,
    type: "xmr",
  };
}

/**
 * Proportion control chart (p-chart) limits. For binomial data like
 * "fraction of stories meeting DoD" or "PR-acceptance rate".
 *
 * @param successes  per-period successful counts
 * @param trials     per-period total counts (same length as successes)
 */
export function pChartLimits(successes: number[], trials: number[]): ControlLimits {
  if (successes.length === 0 || successes.length !== trials.length) {
    return { centerLine: 0, ucl: 0, lcl: 0, type: "p-chart" };
  }
  const totSucc = successes.reduce((a, b) => a + b, 0);
  const totTrial = trials.reduce((a, b) => a + b, 0);
  const pBar = totTrial === 0 ? 0 : totSucc / totTrial;
  const nBar = totTrial / trials.length;
  if (nBar === 0) return { centerLine: pBar, ucl: pBar, lcl: pBar, type: "p-chart", sigma: 0 };
  const sd = Math.sqrt((pBar * (1 - pBar)) / nBar);
  return {
    centerLine: pBar,
    ucl: Math.min(1, pBar + 3 * sd),
    lcl: Math.max(0, pBar - 3 * sd),
    type: "p-chart",
    // Publish the UNCLAMPED σ. UCL/LCL are clamped into [0,1] — routine on
    // pass-rate charts where pBar + 3σ > 1 — and back-deriving σ from the
    // clamped UCL collapses it (measured 0.019 against a true 0.081). That
    // fake σ folds the ±2σ zone onto the centre line, so Rule 5 fires on
    // every point and (because the rule loop `continue`s) masks Rule 2.
    sigma: sd,
  };
}

/**
 * Western Electric Rules — common subset:
 *  - Rule 1: any single point beyond ±3σ (UCL/LCL)
 *  - Rule 2: 9 consecutive points on the same side of the center line
 *  - Rule 3: 6 consecutive points monotonic
 *  - Rule 5: 2 of 3 consecutive points beyond ±2σ on the same side
 *
 * The ±2σ zone needs the chart's TRUE σ. Prefer `limits.sigma` when the
 * chart publishes it (p-chart does) and only fall back to deriving it from
 * the limit width for charts that don't (xmR): p-chart UCL is clamped at 1,
 * so on any high pass-rate series the derived σ is a small fraction of the
 * real one, the ±2σ band lands inside the noise, and Rule 5 fires on every
 * point — which also suppresses Rule 2/3 because the loop `continue`s.
 */
export function westernElectricRules(
  series: number[],
  limits: ControlLimits
): OutOfControlSignal[] {
  const out: OutOfControlSignal[] = [];
  const sigma =
    limits.sigma !== undefined && Number.isFinite(limits.sigma)
      ? limits.sigma
      : (limits.ucl - limits.centerLine) / 3;
  if (sigma <= 0) return out;

  for (let i = 0; i < series.length; i++) {
    const v = series[i];

    // Rule 1: point beyond control limits
    if (v > limits.ucl || v < limits.lcl) {
      out.push({ index: i, rule: "rule-1", description: "Point beyond control limits" });
      continue;
    }

    // Rule 5: 2 of last 3 beyond ±2σ same side
    if (i >= 2) {
      const last3 = series.slice(i - 2, i + 1);
      const aboveTwo = last3.filter((x) => x > limits.centerLine + 2 * sigma).length;
      const belowTwo = last3.filter((x) => x < limits.centerLine - 2 * sigma).length;
      if (aboveTwo >= 2 || belowTwo >= 2) {
        out.push({ index: i, rule: "rule-5", description: "2 of 3 points beyond ±2σ" });
        continue;
      }
    }

    // Rule 2: 9 consecutive on same side
    if (i >= 8) {
      const last9 = series.slice(i - 8, i + 1);
      const allAbove = last9.every((x) => x > limits.centerLine);
      const allBelow = last9.every((x) => x < limits.centerLine);
      if (allAbove || allBelow) {
        out.push({ index: i, rule: "rule-2", description: "9 consecutive points on same side" });
        continue;
      }
    }

    // Rule 3: 6 consecutive monotonic
    if (i >= 5) {
      const last6 = series.slice(i - 5, i + 1);
      let increasing = true;
      let decreasing = true;
      for (let j = 1; j < last6.length; j++) {
        if (last6[j] <= last6[j - 1]) increasing = false;
        if (last6[j] >= last6[j - 1]) decreasing = false;
      }
      if (increasing || decreasing) {
        out.push({ index: i, rule: "rule-3", description: "6 consecutive points monotonic" });
      }
    }
  }
  return out;
}
