/**
 * The Monte Carlo histogram in words: a one-sentence summary and the
 * distribution as a table, both built from the bars the chart draws.
 */

import { fmt, plural, type ChartText } from "@/lib/charts/chart-text";

export interface SimulationText {
  /** One bar per sprint count: how many runs finished in that many sprints. */
  histogram: readonly { sprints: number; count: number }[];
  /** Total runs. */
  total: number;
  p50: number;
  p85: number;
  p95: number;
  /** The user's target sprint count, or null. */
  target: number | null;
}

const share = (count: number, total: number) => (total > 0 ? (count / total) * 100 : 0);

export function simulationHistogramText({
  histogram,
  total,
  p50,
  p85,
  p95,
  target,
}: SimulationText): ChartText {
  let summary: string;
  if (histogram.length === 0 || total <= 0) {
    summary = "No simulation yet.";
  } else {
    const runs = total.toLocaleString("en-US");
    let targetClause = "";
    if (target !== null) {
      const within = histogram.filter((h) => h.sprints <= target).reduce((s, h) => s + h.count, 0);
      targetClause = `; ${fmt(share(within, total), 0)}% finish within the target of ${plural(
        target,
        "sprint"
      )}`;
    }
    // A percentile equal to a higher one says nothing the higher one doesn't.
    const sprints = (n: number) => plural(n, "sprint");
    const spread =
      histogram.length === 1
        ? `every run finishes in ${sprints(histogram[0].sprints)}`
        : p50 === p95
          ? `95% finish within ${sprints(p95)}`
          : p50 === p85
            ? `85% finish within ${sprints(p85)} and 95% within ${fmt(p95)}`
            : p85 === p95
              ? `half finish within ${sprints(p50)} and 95% within ${fmt(p95)}`
              : `half finish within ${sprints(p50)}, 85% within ${fmt(p85)} and 95% within ${fmt(p95)}`;
    summary = `In ${runs} simulated runs, ${spread}${targetClause}.`;
  }

  return {
    summary,
    table: {
      caption: "Simulated runs by sprints needed",
      columns: ["Sprints needed", "Runs", "Share of runs"],
      rows: histogram.map((h) => [h.sprints, h.count, `${fmt(share(h.count, total))}%`]),
    },
  };
}
