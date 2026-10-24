/**
 * The burnup chart in words: a one-sentence summary and the plotted series as
 * a table, both built from the rows the chart draws. The share done is
 * lib/sprints/metrics `completionPct` against the scope that day.
 */

import { cell, fmt, move, NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import { completionPct } from "@/lib/sprints/metrics";
import type { BurnOff } from "@/lib/sprints/burn";
import type { BurnupChartRow } from "./charts";

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** A chart row with what the table can add: a day off, scope that joined or left. */
export type BurnupTextRow = BurnupChartRow & {
  off?: BurnOff;
  added?: number;
  removed?: number;
};

const OFF_LABEL: Record<NonNullable<BurnOff>, string> = {
  weekend: "Weekend",
  holiday: "Holiday",
};

export function burnupChartText(rows: readonly BurnupTextRow[]): ChartText {
  const scopes = rows.map((r) => r.scope).filter(isNum);
  const done = rows.filter((r): r is BurnupTextRow & { completed: number } => isNum(r.completed));

  let summary: string;
  if (rows.length === 0 || scopes.length === 0) {
    summary = "No sprint days to chart yet.";
  } else {
    const firstScope = scopes[0];
    const lastScope = scopes[scopes.length - 1];
    const scopeClause = `scope ${move(firstScope, lastScope)} points`;
    const last = done[done.length - 1];
    if (!last || (done.length === 1 && last.day === 0 && last.completed === 0)) {
      summary = `No points logged yet; ${scopeClause}.`;
    } else {
      const scopeThen = isNum(last.scope) ? last.scope : lastScope;
      const pct = completionPct(last.completed, scopeThen);
      summary = `${fmt(last.completed)} of ${fmt(scopeThen)} points done by day ${last.day}${
        pct === null ? "" : ` (${pct}%)`
      }; ${scopeClause}.`;
    }
  }
  if (rows.some((r) => r.off)) summary += " Days off are shaded.";

  const hasForecast = rows.some((r) => isNum(r.forecast));
  const hasOff = rows.some((r) => r.off);
  const hasMoves = rows.some((r) => (r.added ?? 0) > 0 || (r.removed ?? 0) > 0);
  const columns = [
    "Day",
    "Scope",
    "Done",
    ...(hasMoves ? ["Added", "Removed"] : []),
    ...(hasForecast ? ["Forecast", "80% range"] : []),
    ...(hasOff ? ["Day off"] : []),
  ];
  const tableRows = rows.map((r) => [
    r.day,
    cell(r.scope),
    cell(r.completed),
    ...(hasMoves
      ? [r.added ? `+${fmt(r.added)}` : NO_VALUE, r.removed ? `−${fmt(r.removed)}` : NO_VALUE]
      : []),
    ...(hasForecast
      ? [
          cell(r.forecast),
          isNum(r.band80Lower) && isNum(r.band80Upper)
            ? `${fmt(r.band80Lower)}–${fmt(r.band80Upper)}`
            : NO_VALUE,
        ]
      : []),
    ...(hasOff ? [r.off ? OFF_LABEL[r.off] : ""] : []),
  ]);

  return {
    summary,
    table: { caption: "Scope and points done by sprint day", columns, rows: tableRows },
  };
}
