/**
 * The score trend chart in words: a one-sentence summary and the per-date
 * scores as a table, both built from the points the chart draws.
 */

import { cell, fmt, listAnd, move, plural, type ChartText } from "@/lib/charts/chart-text";
import type { TrendPoint } from "./trend";

const isNum = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** "NPS rose from -20 to 35" over its dated points, or "NPS was 35" for one. */
function seriesClause(label: string, values: number[], show: (v: number) => string): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return `${label} was ${show(values[0])}`;
  return `${label} ${move(values[0], values[values.length - 1], show)}`;
}

export function scoreTrendText(points: readonly TrendPoint[]): ChartText {
  const nps = points.map((p) => p.nps).filter(isNum);
  const csat = points.map((p) => p.csat).filter(isNum);
  const clauses = [
    seriesClause("NPS", nps, (v) => fmt(v, 0)),
    seriesClause("CSAT", csat, (v) => fmt(v)),
  ].filter((c): c is string => c !== null);

  let summary: string;
  if (points.length === 0 || clauses.length === 0) {
    summary = "No responses yet.";
  } else if (points.length === 1) {
    summary = `${listAnd(clauses)} on ${points[0].date}.`;
  } else {
    summary = `${listAnd(clauses)} across ${plural(points.length, "date")}, ${points[0].date} to ${
      points[points.length - 1].date
    }.`;
  }

  return {
    summary,
    table: {
      caption: "NPS (−100 to 100) and CSAT (1 to 5) by date",
      columns: ["Date", "NPS", "CSAT"],
      rows: points.map((p) => [p.date, cell(p.nps, 0), cell(p.csat)]),
    },
  };
}
