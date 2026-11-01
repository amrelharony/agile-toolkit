/**
 * DoD Builder: the adherence-by-sprint chart's points and text alternative,
 * and the advanced statistics over sprints (a p-chart and a Mann-Kendall
 * trend), each behind its minimum sample. Pure, so the page builds the
 * summary and table without loading Recharts.
 */

import { pChartLimits } from "@/lib/analytics/control-chart";
import { mannKendall, type MannKendallResult } from "@/lib/analytics/trend-test";
import { enoughData } from "@/lib/analytics/min-sample";
import { NO_VALUE, fmt, plural, type ChartText } from "@/lib/charts/chart-text";
import type { SprintAdherenceRow } from "@/lib/dod/model";

/** Sprints with done stories before the chart shows: one sprint has no direction. */
export const CHART_MIN_SPRINTS = 2;
/** The most recent sprints the chart and the statistics read. */
export const SERIES_CAP = 20;

export interface AdherencePoint {
  sprintId: string;
  name: string;
  /** Done stories meeting the DoD, as a % of the sprint's done stories. */
  pct: number;
  meeting: number;
  done: number;
}

/** The sprints with a percentage, oldest first, the latest SERIES_CAP. */
export function adherencePoints(rows: readonly SprintAdherenceRow[]): AdherencePoint[] {
  return rows
    .flatMap((r) =>
      r.pct === null
        ? []
        : [{ sprintId: r.sprintId, name: r.name, pct: r.pct, meeting: r.meeting, done: r.done }]
    )
    .slice(-SERIES_CAP);
}

export function adherenceChartText(points: readonly AdherencePoint[]): ChartText {
  const first = points[0];
  const last = points[points.length - 1];
  const summary =
    !first || !last
      ? "No sprint has done stories yet."
      : points.length === 1
        ? `${last.name}: ${last.meeting} of ${plural(last.done, "done story", "done stories")} met the DoD.`
        : `Done stories meeting the DoD ${
            first.pct === last.pct
              ? `stayed at ${last.pct}%`
              : `${last.pct > first.pct ? "rose" : "fell"} from ${first.pct}% in ${first.name} to ${last.pct}% in ${last.name}`
          } (${plural(points.length, "sprint")}).`;
  return {
    summary,
    table: {
      columns: ["Sprint", "Done stories", "Meeting the DoD", "Adherence"],
      rows: points.map((p) => [p.name, p.done, p.meeting, `${p.pct}%`]),
    },
  };
}

export interface AdherenceControl {
  centerLinePct: number;
  uclPct: number;
  lclPct: number;
}

/** p-chart limits on adherence per sprint; null below the change-point sample. */
export function adherenceControl(points: readonly AdherencePoint[]): AdherenceControl | null {
  if (!enoughData(points.length, "changePoint")) return null;
  const limits = pChartLimits(
    points.map((p) => p.meeting),
    points.map((p) => p.done)
  );
  return {
    centerLinePct: limits.centerLine * 100,
    uclPct: limits.ucl * 100,
    lclPct: limits.lcl * 100,
  };
}

/** Which sprints fall outside the control limits, in words. */
export function controlSentence(
  points: readonly AdherencePoint[],
  control: AdherenceControl
): string {
  const out = points.filter((p) => p.pct < control.lclPct || p.pct > control.uclPct);
  return `Adherence averages ${fmt(control.centerLinePct, 0)}% across ${plural(points.length, "sprint")}; ${
    out.length === 0
      ? "every sprint is inside the control limits."
      : `${out.map((p) => p.name).join(", ")} ${out.length === 1 ? "is" : "are"} outside them.`
  }`;
}

/** A direction of travel in adherence; null below the trend sample. */
export function adherenceTrend(points: readonly AdherencePoint[]): MannKendallResult | null {
  if (!enoughData(points.length, "trend")) return null;
  return mannKendall(points.map((p) => p.pct));
}

export function trendSentence(trend: MannKendallResult): string {
  if (!trend.significant) return "No significant trend in adherence across the sprints.";
  return `Adherence is trending ${trend.trend === "up" ? "up" : "down"} (Mann-Kendall p = ${fmt(
    trend.pValue,
    3
  )}).`;
}

/** A table cell for a percentage that may be missing. */
export const pctCell = (pct: number | null) => (pct === null ? NO_VALUE : `${pct}%`);
