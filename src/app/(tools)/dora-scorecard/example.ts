import { exampleId } from "@/components/tool-frame/example-data";
import { currentQuarterIndex, dashQuarter } from "@/lib/roadmap/quarters";
import type { DoraSample } from "@/lib/stores/workspace-types";

/**
 * Six quarters of a team moving its pipeline to trunk-based delivery, up
 * to the last full quarter: deploys rise from under one a week to eight,
 * lead time falls from over two weeks to about a day, and failures and
 * restores improve with them. The latest quarter was filled from the
 * team's data, so the page shows what a derived sample says it came from.
 *
 * It lives in the page's memory only (`example-` ids, never written to the
 * scorecard): the agent and the next-step cards never see it.
 */
export function buildExample(now: Date = new Date()): DoraSample[] {
  const last = currentQuarterIndex(now) - 1;
  const rows: Omit<DoraSample, "id" | "quarter">[] = [
    {
      deployFreqPerWeek: 0.8,
      leadTimeHours: 400,
      changeFailRate: 0.18,
      mttrHours: 30,
      description: "Monthly release train; manual regression week before each.",
    },
    { deployFreqPerWeek: 1.2, leadTimeHours: 300, changeFailRate: 0.15, mttrHours: 20 },
    {
      deployFreqPerWeek: 2,
      leadTimeHours: 190,
      changeFailRate: 0.12,
      mttrHours: 12,
      description: "CI pipeline rebuilt; the regression suite runs on every merge.",
    },
    { deployFreqPerWeek: 3.5, leadTimeHours: 120, changeFailRate: 0.1, mttrHours: 8 },
    {
      deployFreqPerWeek: 5,
      leadTimeHours: 70,
      changeFailRate: 0.09,
      mttrHours: 4,
      description: "Feature flags for unfinished work; trunk-based from mid-quarter.",
    },
    {
      deployFreqPerWeek: 8,
      leadTimeHours: 30,
      changeFailRate: 0.0577,
      mttrHours: 2,
      description: "Filled from the release log, the boards and the incident log.",
      source: "derived",
      derivedFrom: { releases: 104, rolledBack: 6, items: 58, incidents: 3 },
    },
  ];
  return rows.map((row, i) => {
    const quarter = dashQuarter(last - (rows.length - 1) + i);
    return { id: exampleId(`dora-${quarter}`), quarter, ...row };
  });
}
