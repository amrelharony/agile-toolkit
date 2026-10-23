/**
 * The pass-rate statistics behind "Advanced analysis": a trend chart with
 * its text alternative, a Mann-Kendall trend test and p-chart limits with
 * the Western Electric drift rule. Each runs only with enough checks
 * (lib/analytics/min-sample): on a handful of stories they read like
 * findings but are noise.
 */

import { pChartLimits, westernElectricRules } from "@/lib/analytics/control-chart";
import { enoughData, MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { mannKendall, type MannKendallResult } from "@/lib/analytics/trend-test";
import { fmt, mean, move, type ChartText } from "@/lib/charts/chart-text";
import type { PassRecord } from "./session";

/** The chart and the tests look at the latest checks only. */
export const PASS_RATE_WINDOW = 20;

/**
 * Mann-Kendall's own floor: below 10 points its p-value isn't trusted and
 * it never reports a trend (lib/analytics/trend-test.ts), so a "no trend"
 * there would only mean "too few checks".
 */
export const TREND_TEST_MIN = 10;

export interface ControlLines {
  centerLinePct: number;
  uclPct: number;
  lclPct: number;
}

export interface PassRateAnalysis {
  /** The checks in the window, oldest first. */
  window: PassRecord[];
  /** Chart summary and table; null below the trend minimum. */
  chart: ChartText | null;
  /** Mann-Kendall on the window; null below TREND_TEST_MIN. */
  trend: MannKendallResult | null;
  /** p-chart limits; null below the control-chart minimum. */
  control: ControlLines | null;
  /** The last check completes a run of 9 on one side of the centre line. */
  drift: boolean;
}

const pct = (v: number) => `${fmt(v, 0)}%`;

export function passRateAnalysis(records: readonly PassRecord[]): PassRateAnalysis {
  const window = records.slice(-PASS_RATE_WINDOW);
  const n = window.length;
  if (!enoughData(n, "trend"))
    return { window, chart: null, trend: null, control: null, drift: false };

  const rates = window.map((r) => r.passRate);
  const avg = mean(rates) ?? 0;
  const chart: ChartText = {
    summary: `Pass rate ${move(rates[0], rates[n - 1], pct)} over the last ${n} checks; the average is ${pct(avg)}.`,
    table: {
      columns: ["Story", "Checked on", "Pass rate (%)"],
      rows: window.map((r) => [r.name, r.date, r.passRate]),
    },
  };
  const trend = enoughData(n, TREND_TEST_MIN) ? mannKendall(rates) : null;

  let control: ControlLines | null = null;
  let drift = false;
  if (enoughData(n, MIN_SAMPLE.changePoint)) {
    const limits = pChartLimits(
      window.map((r) => r.metCount),
      window.map((r) => r.totalCriteria)
    );
    control = {
      centerLinePct: limits.centerLine * 100,
      uclPct: limits.ucl * 100,
      lclPct: limits.lcl * 100,
    };
    // Western Electric Rule 2: nine in a row on one side of the centre line.
    const ratios = window.map((r) => (r.totalCriteria > 0 ? r.metCount / r.totalCriteria : 0));
    drift = westernElectricRules(ratios, limits).some(
      (s) => s.rule === "rule-2" && s.index === n - 1
    );
  }
  return { window, chart, trend, control, drift };
}

/** The trend test's result as a sentence. */
export function trendSentence(trend: MannKendallResult): string {
  const p = trend.pValue.toFixed(2);
  if (!trend.significant || trend.trend === "none") {
    return `No clear trend in the pass rate (Mann-Kendall p = ${p}).`;
  }
  return trend.trend === "up"
    ? `Stories are arriving readier over time (Mann-Kendall p = ${p}).`
    : `Stories are arriving less ready over time (Mann-Kendall p = ${p}).`;
}
