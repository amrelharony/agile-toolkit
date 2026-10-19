/**
 * The health trend chart in words: a one-sentence summary and each check's
 * lights as a table, both built from the rows the chart draws (2 = green,
 * 1 = yellow, 0 = red).
 */

import { listAnd, plural, type ChartText } from "@/lib/charts/chart-text";
import { HEALTH_CHECK_DIMENSIONS as DIMENSIONS } from "@/lib/stores/workspace-types";
import type { HealthTrendRow } from "./charts";

type Light = "Red" | "Yellow" | "Green";

const lightOf = (v: unknown): Light => (v === 2 ? "Green" : v === 1 ? "Yellow" : "Red");

export function healthTrendText(rows: readonly HealthTrendRow[]): ChartText {
  let summary: string;
  if (rows.length === 0) {
    summary = "No checks saved yet.";
  } else {
    const latest = rows[rows.length - 1];
    const counts = { Green: 0, Yellow: 0, Red: 0 };
    for (const d of DIMENSIONS) counts[lightOf(latest[d])] += 1;
    const lights = listAnd([
      `${counts.Green} green`,
      `${counts.Yellow} yellow`,
      `${counts.Red} red`,
    ]);
    summary =
      rows.length === 1
        ? `One check (${latest.name}) with ${lights} of ${DIMENSIONS.length} dimensions.`
        : `${plural(rows.length, "check")} from ${rows[0].name} to ${latest.name}; the latest has ${lights} of ${DIMENSIONS.length} dimensions.`;
  }

  return {
    summary,
    table: {
      caption: "Light per dimension by check",
      columns: ["Check", ...DIMENSIONS],
      rows: rows.map((r) => [String(r.name), ...DIMENSIONS.map((d) => lightOf(r[d]))]),
    },
  };
}
