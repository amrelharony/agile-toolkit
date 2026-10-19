/**
 * The burndown chart in words: a one-sentence summary and the plotted series
 * as a table, both built from the rows the chart draws.
 */

import { cell, fmt, move, plural, NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import type { BurndownChartRow } from "./charts";

/** Within half a point of the ideal line reads as on it (the stat cards agree). */
const ON_LINE = 0.5;

export function burndownChartText(rows: readonly BurndownChartRow[]): ChartText {
  const logged = rows.filter(
    (r): r is BurndownChartRow & { actual: number } =>
      typeof r.actual === "number" && Number.isFinite(r.actual)
  );

  let summary: string;
  if (rows.length === 0) {
    summary = "No sprint days to chart yet.";
  } else if (logged.length === 0 || (logged.length === 1 && logged[0].day === 0)) {
    // Day 0's starting scope alone isn't a log.
    const last = rows[rows.length - 1];
    summary = `No days logged yet; the ideal line falls from ${fmt(rows[0].ideal)} points to 0 by day ${last.day}.`;
  } else {
    const first = logged[0];
    const last = logged[logged.length - 1];
    const gap = last.actual - last.ideal; // > 0: more left than planned
    const position =
      Math.abs(gap) <= ON_LINE
        ? "on the ideal line"
        : `${fmt(Math.abs(gap))} points ${gap > 0 ? "behind" : "ahead of"} the ideal line`;
    summary =
      logged.length === 1
        ? `${plural(last.actual, "point")} remaining on day ${last.day}; ${position}.`
        : `Remaining points ${move(first.actual, last.actual)} over ${plural(
            last.day - first.day,
            "day"
          )}; ${position}.`;
  }

  const hasForecast = rows.some((r) => typeof r.forecast === "number");
  const columns = ["Day", "Ideal", "Remaining", ...(hasForecast ? ["Forecast", "80% range"] : [])];
  const tableRows = rows.map((r) => [
    r.day,
    cell(r.ideal),
    cell(r.actual),
    ...(hasForecast
      ? [
          cell(r.forecast),
          typeof r.band80Lower === "number" && typeof r.band80Upper === "number"
            ? `${fmt(r.band80Lower)}–${fmt(r.band80Upper)}`
            : NO_VALUE,
        ]
      : []),
  ]);

  return {
    summary,
    table: { caption: "Points remaining by sprint day", columns, rows: tableRows },
  };
}
