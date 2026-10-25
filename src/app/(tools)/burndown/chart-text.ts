/**
 * The burndown chart in words: a one-sentence summary and the plotted series
 * as a table, both built from the rows the chart draws. The position against
 * the ideal line is lib/sprints/metrics `gap` (positive is behind), the
 * number the tiles and the verdict quote.
 */

import { cell, fmt, move, plural, NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import { gap as gapOf } from "@/lib/sprints/metrics";
import type { BurnOff, BurnSource } from "@/lib/sprints/burn";
import { points } from "@/lib/sprints/hub-view";
import type { BurndownChartRow } from "./charts";

/** A chart row with what the table can add: a day off, scope that joined or left. */
export type BurndownTextRow = BurndownChartRow & {
  off?: BurnOff;
  added?: number;
  removed?: number;
  /**
   * The day's gap from the burn (BurnDay.gap), worked out from the exact
   * ideal; without it the summary works it out from the rounded `ideal`.
   */
  gap?: number | null;
};

const OFF_LABEL: Record<NonNullable<BurnOff>, string> = {
  weekend: "Weekend",
  holiday: "Holiday",
};

const OFF_DAYS = " Days off are shaded: the ideal line stays flat across them.";

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
    // > 0: more left than planned
    const g = typeof last.gap === "number" ? last.gap : gapOf(last.actual, last.ideal);
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
  if (rows.some((r) => r.off)) summary += OFF_DAYS;

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

/** What the board's wording needs besides the rows. */
export interface BurnTextContext {
  /** Where the rows came from: only the board's are worded differently. */
  source: BurnSource;
  /** The sprint has real dates, so the board can be read by day. */
  dated: boolean;
  /** Open stories without points while the board is the source. */
  unpointedOpen: number;
  /** Points done and in scope now (an undated sprint's summary). */
  done: number;
  scope: number;
}

const noPoints = (n: number) =>
  `${n} ${n === 1 ? "open story has" : "open stories have"} no points`;

/**
 * The burndown in words for the source it was read from: Burndown's own
 * summary and table, with the board's wording where the log's would
 * mislead. Nothing is typed on the board, so it never says "No days logged"
 * (before the start, on day 0, or without dates). While open stories have
 * no points it says the board can't show all that's left, and with every
 * pointed story done it claims no pace. The Burndown page and the Sprint
 * cockpit both read it.
 */
export function burnChartText(rows: readonly BurndownTextRow[], ctx: BurnTextContext): ChartText {
  const text = burndownChartText(rows);
  const n = ctx.unpointedOpen;
  if (ctx.source !== "stories" || rows.length === 0) return text;
  const read = rows.filter(
    (r): r is BurndownTextRow & { actual: number } => typeof r.actual === "number"
  );
  const falls = `the ideal line falls from ${fmt(rows[0].ideal)} points to 0 by day ${
    rows[rows.length - 1].day
  }`;
  const end = read[read.length - 1];
  // Burndown's own summary already says the days off are shaded; the board's wording keeps it.
  const offDays = rows.some((r) => r.off) ? OFF_DAYS : "";
  let summary: string;
  if (read.length === 0) {
    summary = ctx.dated
      ? `Nothing has burned down yet; ${falls}.${offDays}`
      : `${fmt(ctx.done)} of ${points(ctx.scope)} done; set the sprint's dates to see the burndown by day.`;
  } else if (read.length === 1 && end.day === 0) {
    summary = `${points(end.actual)} left on day 0; ${falls}.${offDays}`;
  } else if (n > 0 && end.actual <= 0) {
    summary = `No pointed work left on day ${end.day}.${offDays}`;
  } else {
    summary = text.summary;
  }
  const caveat = n > 0 ? ` ${noPoints(n)}, so the board can't show all that's left.` : "";
  return { ...text, summary: `${summary}${caveat}` };
}
