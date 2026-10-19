/**
 * The burnup chart in words: a one-sentence summary and the plotted series as
 * a table, both built from the rows the chart draws.
 */

import { cell, fmt, move, NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import type { BurnupChartRow } from "./charts";

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function burnupChartText(rows: readonly BurnupChartRow[]): ChartText {
  const scopes = rows.map((r) => r.scope).filter(isNum);
  const done = rows.filter((r): r is BurnupChartRow & { completed: number } => isNum(r.completed));

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
      const pct =
        scopeThen > 0
          ? Math.max(0, Math.min(100, Math.round((last.completed / scopeThen) * 100)))
          : 0;
      summary = `${fmt(last.completed)} of ${fmt(scopeThen)} points done by day ${last.day} (${pct}%); ${scopeClause}.`;
    }
  }

  const hasForecast = rows.some((r) => isNum(r.forecast));
  const columns = ["Day", "Scope", "Done", ...(hasForecast ? ["Forecast", "80% range"] : [])];
  const tableRows = rows.map((r) => [
    r.day,
    cell(r.scope),
    cell(r.completed),
    ...(hasForecast
      ? [
          cell(r.forecast),
          isNum(r.band80Lower) && isNum(r.band80Upper)
            ? `${fmt(r.band80Lower)}–${fmt(r.band80Upper)}`
            : NO_VALUE,
        ]
      : []),
  ]);

  return {
    summary,
    table: { caption: "Scope and points done by sprint day", columns, rows: tableRows },
  };
}
