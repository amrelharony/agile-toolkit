/**
 * The statistics behind "Advanced analysis": bootstrap confidence ranges
 * for the median and the 85th percentile, CUSUM change points over the
 * items in order of completion, and a Mann-Kendall trend test on the mean
 * cycle time per week. Each runs only from its sample floor
 * (lib/analytics/min-sample), since on a handful of items they read noise
 * as a finding.
 */

import type { CausalAnnotationData } from "@/components/charts/causal-annotation-list";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { enoughData } from "@/lib/analytics/min-sample";
import { isoDayNumber } from "@/lib/sprints/calendar";
import type { CycleRow } from "./types";
import { weeklyMeans } from "./helpers";

export interface CycleAnalysis {
  /** 95% bootstrap ranges; null below MIN_SAMPLE.distribution items. */
  p50Range: { lower: number; upper: number } | null;
  p85Range: { lower: number; upper: number } | null;
  /** On the scatter, at the finish day; empty below MIN_SAMPLE.changePoint items. */
  shifts: CausalAnnotationData[];
  /** Weeks with a finish. */
  weeks: number;
  /** Null below MIN_SAMPLE.trend weeks. */
  trend: { trend: "up" | "down" | "none"; significant: boolean; pValue: number } | null;
}

/** `rows` in order of completion (helpers rowsFrom). */
export function analyseCycleTimes(rows: readonly CycleRow[]): CycleAnalysis {
  const days = rows.map((r) => r.days);
  const ranges = enoughData(days.length, "distribution");
  const range = (q: number) => {
    const ci = bootstrapQuantile(days, q);
    return ci.iterations > 0 ? { lower: ci.lower, upper: ci.upper } : null;
  };
  const shifts: CausalAnnotationData[] = enoughData(days.length, "changePoint")
    ? cusum(days).map((cp) => {
        const row = rows[cp.index];
        const up = cp.direction === "up";
        return {
          x: row ? (isoDayNumber(row.doneOn) as number) : cp.index,
          label: up ? "Cycle-time regime up" : "Cycle-time regime down",
          detail: `CUSUM detected a sustained ${up ? "increase" : "decrease"} in cycle time from ${
            row ? `the item finished on ${row.doneOn}` : `item ${cp.index + 1}`
          }.`,
          // Signed: negative for a downward shift, so compare its size.
          confidence: Math.abs(cp.cumulativeStat) >= 6 ? "strong" : "moderate",
        };
      })
    : [];
  const weekly = weeklyMeans(rows);
  const mk = enoughData(weekly.length, "trend") ? mannKendall(weekly.map((w) => w.mean)) : null;
  return {
    p50Range: ranges ? range(0.5) : null,
    p85Range: ranges ? range(0.85) : null,
    shifts,
    weeks: weekly.length,
    trend: mk ? { trend: mk.trend, significant: mk.significant, pValue: mk.pValue } : null,
  };
}

/** The trend test in a sentence, or null without one. */
export function trendSentence(trend: CycleAnalysis["trend"]): string | null {
  if (!trend) return null;
  const p = `Mann-Kendall p = ${trend.pValue.toFixed(3)}`;
  if (!trend.significant || trend.trend === "none")
    return `No clear trend in the weekly cycle time (${p}).`;
  return trend.trend === "up"
    ? `Cycle time is trending up week by week (${p}): items are taking longer.`
    : `Cycle time is trending down week by week (${p}): items are finishing faster.`;
}
