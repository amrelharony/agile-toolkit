/**
 * Impediment Tracker: the statistics behind "Advanced analysis". Each runs
 * only on enough points (lib/analytics/min-sample): a Mann-Kendall trend
 * or a CUSUM shift over three weeks of counts is noise that reads like a
 * finding, and the page used to show both as headline chips. Pure.
 */

import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { cusum } from "@/lib/analytics/changepoint";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import { mannKendall } from "@/lib/analytics/trend-test";
import { fmt, listAnd } from "@/lib/charts/chart-text";
import { dayLabel, type WeekPoint } from "./helpers";

/**
 * Mann-Kendall's own floor: below 10 points its p-value isn't trusted and
 * it never reports a trend (lib/analytics/trend-test.ts), so a "no trend"
 * there would only mean "too few weeks". Above MIN_SAMPLE.trend on purpose.
 */
export const TREND_TEST_MIN = Math.max(MIN_SAMPLE.trend, 10);

export interface ImpedimentAnalysis {
  weeks: number;
  /** Null below TREND_TEST_MIN weeks. */
  trend: string | null;
  /** Null below MIN_SAMPLE.changePoint weeks. */
  shifts: string | null;
  resolvedCount: number;
  /** Null below MIN_SAMPLE.distribution resolved impediments. */
  median: string | null;
}

/** "More impediments are being raised each week (Mann-Kendall p = 0.01)." */
export function trendSentence(raised: number[]): string {
  const t = mannKendall(raised);
  const p = t.pValue.toFixed(2);
  if (!t.significant || t.trend === "none")
    return `No clear trend in how many impediments are raised each week (Mann-Kendall p = ${p}).`;
  return t.trend === "up"
    ? `More impediments are being raised each week (Mann-Kendall p = ${p}).`
    : `Fewer impediments are being raised each week (Mann-Kendall p = ${p}).`;
}

/** "A sustained rise from the week of 5 Oct (CUSUM)." */
export function shiftSentence(points: readonly WeekPoint[]): string {
  const found = cusum(points.map((p) => p.raised));
  if (found.length === 0)
    return "No sustained shift in how many impediments are raised each week (CUSUM).";
  const parts = found.map(
    (c) =>
      `a sustained ${c.direction === "up" ? "rise" : "drop"} from the week of ${dayLabel(
        points[c.index]?.start
      )}`
  );
  const text = listAnd(parts);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} (CUSUM).`;
}

/** "Median time to resolve: 4 days (95% interval 2–6, over 12 resolved)." */
export function medianSentence(days: number[]): string {
  const ci = bootstrapQuantile(days, 0.5);
  const point = Math.round(ci.point);
  const unit = point === 1 ? "day" : "days";
  const range =
    Number.isFinite(ci.lower) && Number.isFinite(ci.upper)
      ? ` (95% interval ${fmt(ci.lower, 0)}–${fmt(ci.upper, 0)}, over ${days.length} resolved)`
      : ` (over ${days.length} resolved)`;
  return `Median time to resolve: ${point} ${unit}${range}.`;
}

export function analyseImpediments(
  points: readonly WeekPoint[],
  resolvedDays: number[]
): ImpedimentAnalysis {
  const raised = points.map((p) => p.raised);
  return {
    weeks: points.length,
    trend: enoughData(points.length, TREND_TEST_MIN) ? trendSentence(raised) : null,
    shifts: enoughData(points.length, "changePoint") ? shiftSentence(points) : null,
    resolvedCount: resolvedDays.length,
    median: enoughData(resolvedDays.length, "distribution") ? medianSentence(resolvedDays) : null,
  };
}
