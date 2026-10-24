/**
 * The burndown chart in words: a one-sentence summary and the plotted series
 * as a table, both built from the rows the chart draws. The position against
 * the ideal line is lib/sprints/metrics `gap` (positive is behind), the
 * number the tiles and the verdict quote.
 */

import { cell, fmt, move, plural, NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import { gap as gapOf } from "@/lib/sprints/metrics";
import type { BurnOff } from "@/lib/sprints/burn";
import type { BurndownChartRow } from "./charts";

/** A chart row with what the table can add: a day off, scope that joined or left. */
export type BurndownTextRow = BurndownChartRow & {
  off?: BurnOff;
  added?: number;
  removed?: number;
};

const OFF_LABEL: Record<NonNullable<BurnOff>, string> = {
  weekend: "Weekend",
  holiday: "Holiday",
};

export function burndownChartText(rows: readonly BurndownTextRow[]): ChartText {
  const logged = rows.filter(
    (r): r is BurndownTextRow & { actual: number } =>
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
    const g = gapOf(last.actual, last.ideal); // > 0: more left than planned
    const position =
      g === 0
        ? "on the ideal line"
        : `${fmt(Math.abs(g))} points ${g > 0 ? "behind" : "ahead of"} the ideal line`;
    summary =
      logged.length === 1
        ? `${plural(last.actual, "point")} remaining on day ${last.day}; ${position}.`
        : `Remaining points ${move(first.actual, last.actual)} over ${plural(
            last.day - first.day,
            "day"
          )}; ${position}.`;
  }
  if (rows.some((r) => r.off)) {
    summary += " Days off are shaded: the ideal line stays flat across them.";
  }

  const hasForecast = rows.some((r) => typeof r.forecast === "number");
  const hasOff = rows.some((r) => r.off);
  const hasMoves = rows.some((r) => (r.added ?? 0) > 0 || (r.removed ?? 0) > 0);
  const columns = [
    "Day",
    "Ideal",
    "Remaining",
    ...(hasMoves ? ["Added", "Removed"] : []),
    ...(hasForecast ? ["Forecast", "80% range"] : []),
    ...(hasOff ? ["Day off"] : []),
  ];
  const tableRows = rows.map((r) => [
    r.day,
    cell(r.ideal),
    cell(r.actual),
    ...(hasMoves
      ? [r.added ? `+${fmt(r.added)}` : NO_VALUE, r.removed ? `−${fmt(r.removed)}` : NO_VALUE]
      : []),
    ...(hasForecast
      ? [
          cell(r.forecast),
          typeof r.band80Lower === "number" && typeof r.band80Upper === "number"
            ? `${fmt(r.band80Lower)}–${fmt(r.band80Upper)}`
            : NO_VALUE,
        ]
      : []),
    ...(hasOff ? [r.off ? OFF_LABEL[r.off] : ""] : []),
  ]);

  return {
    summary,
    table: { caption: "Points remaining by sprint day", columns, rows: tableRows },
  };
}
