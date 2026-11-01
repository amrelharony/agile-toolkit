/**
 * The velocity charts in words: a one-sentence summary and the plotted
 * series as a table, both built from the rows the chart draws.
 */

import { cell, fmt, mean, plural, NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import { SAY_DO_GRADE_LABEL, type SayDoGrade } from "@/lib/sprints/metrics";
import type { VelocityChartRow } from "./charts";

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** The shared velocity the main chart's summary quotes (lib/sprints/metrics velocity()). */
export interface ChartVelocity {
  average: number | null;
  count: number;
}

const gradeText = (grade: SayDoGrade | undefined, pct: number | undefined) =>
  grade && isNum(pct) ? `${SAY_DO_GRADE_LABEL[grade]} (${pct}%)` : NO_VALUE;

export function velocityChartText(
  rows: readonly VelocityChartRow[],
  velocity?: ChartVelocity
): ChartText {
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
    const last = finished[finished.length - 1];
    const forecast = next ? `, and the next sprint is forecast at ${fmt(next.forecast)}` : "";
    const lastLine = `${last.name} completed ${fmt(last.completed)} of ${fmt(last.committed)} committed${
      last.grade && isNum(last.sayDoPct) ? ` (${last.sayDoPct}%)` : ""
    }${forecast}.`;
    summary =
      velocity && velocity.average !== null
        ? `Velocity is ${fmt(velocity.average)} points over the last ${plural(
            velocity.count,
            "finished sprint"
          )}; ${lastLine}`
        : `Completed points averaged ${fmt(mean(finished.map((r) => r.completed)) ?? 0)} over ${plural(
            finished.length,
            "finished sprint"
          )}; ${lastLine}`;
  }

  const hasGrade = rows.some((r) => r.grade !== undefined);
  const hasRolling = rows.some((r) => isNum(r.rollingAvg));
  const hasTrend = rows.some((r) => isNum(r.trend));
  const columns = [
    "Sprint",
    "Committed",
    "Completed",
    ...(hasGrade ? ["Say/do"] : []),
    ...(hasRolling ? ["Rolling avg"] : []),
    ...(hasTrend ? ["Trend"] : []),
    ...(next ? ["Forecast", "80% range"] : []),
  ];
  const tableRows = rows.map((r) => [
    r.name,
    // The forecast row has no commitment of its own.
    r.forecastOnly ? NO_VALUE : cell(r.committed),
    cell(r.completed),
    ...(hasGrade ? [r.forecastOnly ? NO_VALUE : gradeText(r.grade, r.sayDoPct)] : []),
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

/** The forecast chart in Advanced analysis, in words. */
export function forecastChartText(
  rows: readonly VelocityChartRow[],
  shifts: readonly { sprint: string; direction: "up" | "down" }[]
): ChartText {
  const base = velocityChartText(rows);
  const next = rows.find((r) => r.forecastOnly && isNum(r.forecast));
  const forecast =
    next && isNum(next.forecast)
      ? `The next sprint is forecast at ${fmt(next.forecast)} points${
          isNum(next.band80Lower) && isNum(next.band80Upper)
            ? ` (80% range ${fmt(next.band80Lower)}–${fmt(next.band80Upper)})`
            : ""
        }.`
      : "Not enough finished sprints to forecast the next one.";
  const shift =
    shifts.length === 0
      ? ""
      : ` ${shifts
          .map(
            (s) => `A sustained ${s.direction === "up" ? "rise" : "drop"} starts at ${s.sprint}.`
          )
          .join(" ")}`;
  return {
    summary: `${forecast}${shift}`,
    table: { ...base.table, caption: "Completed points and the forecast by sprint" },
  };
}
