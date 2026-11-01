/**
 * The "Progress over time" and "Confidence over time" charts in words, from
 * lib/okrs progressTrend (one point per check-in day) and confidenceTrend
 * (one per day a check-in scored confidence). Pure, so the summary and
 * table render before the chart's chunk loads.
 */

import { cell, fmt, move, plural, type ChartText } from "@/lib/charts/chart-text";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import type { ConfidencePoint, ProgressPoint } from "@/lib/okrs/progress";

/**
 * Check-in days before a trend line is drawn: three, the fewest means
 * MIN_SAMPLE counts as worth quoting. Fewer, and the verdict's "down from 8
 * since 3 Oct" says it better than a line would.
 */
export const CHART_MIN_DAYS = MIN_SAMPLE.average;

/** "3 Oct 2026" for "2026-10-03" (fixed English, the same on every machine). */
export function dayLabel(iso: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12
    ? `${Number(iso.slice(8, 10))} ${months[m - 1]} ${iso.slice(0, 4)}`
    : iso;
}

/** A progress point as the chart plots it: a whole percentage, rounded as the headline is. */
export const progressPct = (p: ProgressPoint): number => Math.round(p.progress * 100);

export function progressTrendText(points: readonly ProgressPoint[]): ChartText {
  const show = (v: number) => `${v}%`;
  let summary: string;
  if (points.length === 0) summary = "No check-in yet.";
  else if (points.length === 1)
    summary = `Progress was ${show(progressPct(points[0]))} on ${dayLabel(points[0].date)}.`;
  else {
    const first = points[0];
    const last = points[points.length - 1];
    summary = `Progress ${move(progressPct(first), progressPct(last), show)} over ${plural(
      points.length,
      "check-in day"
    )}, ${dayLabel(first.date)} to ${dayLabel(last.date)}.`;
  }
  return {
    summary,
    table: {
      caption: "Objective progress (the mean of its key results'), by check-in day",
      columns: ["Day", "Progress", "Key results checked in"],
      rows: points.map((p) => [dayLabel(p.date), show(progressPct(p)), p.measured]),
    },
  };
}

export function confidenceTrendText(points: readonly ConfidencePoint[]): ChartText {
  const show = (v: number) => `${fmt(v)}/10`;
  let summary: string;
  if (points.length === 0) summary = "No confidence scored at a check-in yet.";
  else if (points.length === 1)
    summary = `Confidence was ${show(points[0].confidence)} on ${dayLabel(points[0].date)}.`;
  else {
    const first = points[0];
    const last = points[points.length - 1];
    summary = `Confidence ${move(first.confidence, last.confidence, show)} over ${plural(
      points.length,
      "check-in day"
    )}, ${dayLabel(first.date)} to ${dayLabel(last.date)}.`;
  }
  return {
    summary,
    table: {
      caption: "Mean confidence of the scored key results, by check-in day",
      columns: ["Day", "Confidence (0–10)", "Key results scored"],
      rows: points.map((p) => [dayLabel(p.date), cell(p.confidence), p.scored]),
    },
  };
}
