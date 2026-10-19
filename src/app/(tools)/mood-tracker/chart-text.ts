/**
 * The daily-average mood chart in words: a one-sentence summary and the
 * per-day averages as a table, both built from the points the chart draws.
 */

import { cell, fmt, move, plural, type ChartText } from "@/lib/charts/chart-text";

export interface MoodPoint {
  date: string;
  avg: number;
}

export function dailyMoodText(points: readonly MoodPoint[]): ChartText {
  let summary: string;
  if (points.length === 0) {
    summary = "No moods logged yet.";
  } else if (points.length === 1) {
    summary = `Average mood was ${fmt(points[0].avg)} out of 5 on ${points[0].date}.`;
  } else {
    const avgs = points.map((p) => p.avg);
    const first = points[0];
    const last = points[points.length - 1];
    summary = `Daily average mood ${move(first.avg, last.avg)} out of 5 over ${plural(
      points.length,
      "day"
    )} with entries, from ${first.date} to ${last.date}; lowest ${fmt(
      Math.min(...avgs)
    )}, highest ${fmt(Math.max(...avgs))}.`;
  }

  return {
    summary,
    table: {
      caption: "Average mood (1 to 5) by day",
      columns: ["Date", "Average mood"],
      rows: points.map((p) => [p.date, cell(p.avg, 2)]),
    },
  };
}
