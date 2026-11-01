/**
 * Working Agreement: the adherence-by-check-in chart's points and text
 * alternative, and the trend test behind its minimum sample. Pure, so the
 * page builds the summary and table without loading Recharts.
 */

import { mannKendall, type MannKendallResult } from "@/lib/analytics/trend-test";
import { enoughData } from "@/lib/analytics/min-sample";
import { NO_VALUE, fmt, type ChartText } from "@/lib/charts/chart-text";
import {
  TREND_MIN_ROUNDS,
  adherenceCount,
  dayLabel,
  trendSentence,
  type CheckInTrendRow,
} from "@/lib/working-agreement/model";

export interface AdherencePoint {
  id: string;
  /** "3 Sep". */
  label: string;
  /** Working as a % of the rules checked, a rule partly working counting as half. */
  pct: number;
  working: number;
  partly: number;
  checked: number;
}

/** The rounds that checked something, oldest first. */
export function adherencePoints(rows: readonly CheckInTrendRow[]): AdherencePoint[] {
  return rows.flatMap((r) =>
    r.pct === null
      ? []
      : [
          {
            id: r.id,
            label: dayLabel(r.date),
            pct: r.pct,
            working: r.working,
            partly: r.partly,
            checked: r.checked,
          },
        ]
  );
}

/** Whether there are enough rounds for the chart. */
export const chartReady = (points: readonly AdherencePoint[]) => points.length >= TREND_MIN_ROUNDS;

export function adherenceChartText(
  rows: readonly CheckInTrendRow[],
  sprintName: (id: string | undefined) => string | undefined
): ChartText {
  return {
    summary: trendSentence(rows) ?? "Save two check-ins to see how adherence moves.",
    table: {
      columns: ["Check-in", "Version", "Sprint", "Working", "Adherence"],
      rows: rows.map((r) => [
        dayLabel(r.date, true),
        `v${r.version}`,
        sprintName(r.sprintId) ?? NO_VALUE,
        adherenceCount(r),
        r.pct === null ? NO_VALUE : `${r.pct}%`,
      ]),
    },
  };
}

/** A direction of travel in adherence; null below MIN_SAMPLE.trend rounds. */
export function adherenceTrend(points: readonly AdherencePoint[]): MannKendallResult | null {
  if (!enoughData(points.length, "trend")) return null;
  return mannKendall(points.map((p) => p.pct));
}

export function trendTestSentence(trend: MannKendallResult): string {
  if (!trend.significant) return "No significant trend in adherence across the check-ins.";
  return `Adherence is trending ${trend.trend === "up" ? "up" : "down"} (Mann-Kendall p = ${fmt(
    trend.pValue,
    3
  )}).`;
}
