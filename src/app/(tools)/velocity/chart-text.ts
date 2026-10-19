/**
 * The velocity chart in words: a one-sentence summary and the plotted series
 * as a table, both built from the rows the chart draws.
 */

import { cell, fmt, mean, plural, NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import type { VelocityChartRow } from "./charts";

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function velocityChartText(rows: readonly VelocityChartRow[]): ChartText {
  const sprints = rows.filter((r) => !r.forecastOnly);
  const finished = sprints.filter((r): r is VelocityChartRow & { completed: number } =>
    isNum(r.completed)
  );
  const next = rows.find(
    (r): r is VelocityChartRow & { forecast: number } =>
      Boolean(r.forecastOnly) && isNum(r.forecast)
  );

  let summary: string;
  if (finished.length === 0) {
    summary =
      sprints.length === 0
        ? "No sprints yet."
        : `No finished sprints yet; ${plural(sprints.length, "sprint")} planned.`;
  } else {
    const avg = mean(finished.map((r) => r.completed)) ?? 0;
    const last = finished[finished.length - 1];
    const forecast = next ? `, and the next sprint is forecast at ${fmt(next.forecast)}` : "";
    summary = `Completed points averaged ${fmt(avg)} over ${plural(
      finished.length,
      "finished sprint"
    )}; ${last.name} completed ${fmt(last.completed)} of ${fmt(last.committed)} committed${forecast}.`;
  }

  const hasRolling = rows.some((r) => isNum(r.rollingAvg));
  const hasTrend = rows.some((r) => isNum(r.trend));
  const columns = [
    "Sprint",
    "Committed",
    "Completed",
    ...(hasRolling ? ["Rolling avg"] : []),
    ...(hasTrend ? ["Trend"] : []),
    ...(next ? ["Forecast", "80% range"] : []),
  ];
  const tableRows = rows.map((r) => [
    r.name,
    // The forecast row has no commitment of its own.
    r.forecastOnly ? NO_VALUE : cell(r.committed),
    cell(r.completed),
    ...(hasRolling ? [cell(r.rollingAvg)] : []),
    ...(hasTrend ? [cell(r.trend)] : []),
    // The last finished sprint carries a bridge point so the band starts
    // where history ends; only the forecast row holds a real forecast.
    ...(next
      ? r.forecastOnly
        ? [
            cell(r.forecast),
            isNum(r.band80Lower) && isNum(r.band80Upper)
              ? `${fmt(r.band80Lower)}–${fmt(r.band80Upper)}`
              : NO_VALUE,
          ]
        : [NO_VALUE, NO_VALUE]
      : []),
  ]);

  return {
    summary,
    table: { caption: "Points committed and completed by sprint", columns, rows: tableRows },
  };
}
