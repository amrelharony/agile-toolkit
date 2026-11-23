/**
 * Measure ideas for each EBM key value area: our own short names and our
 * own one-line definitions (common metric names such as cycle time or NPS
 * are fine; nothing follows the EBM Guide's own list or its wording). The
 * page offers them as quick adds and `ebm-dashboard.measures` answers with
 * them when there's no AI.
 *
 * Pure, and free of zod: the task's lite module imports it.
 */

import type { EbmValueArea, MetricDirection, MetricSourceId } from "@/lib/stores/workspace-types";

export interface MeasureIdea {
  name: string;
  definition: string;
  unit?: string;
  direction: MetricDirection;
  /** The toolkit's own number it can be read from. */
  source?: MetricSourceId;
}

export const MEASURE_IDEAS: Record<EbmValueArea, readonly MeasureIdea[]> = {
  "current-value": [
    {
      name: "Net Promoter Score",
      definition:
        "How likely people are to recommend the product, from the last 90 days of answers.",
      direction: "increase",
      source: "nps-90d",
    },
    {
      name: "People who used it in the last 30 days",
      definition: "Count the people who did something useful in the product in the last 30 days.",
      unit: "people",
      direction: "increase",
    },
    {
      name: "Customers who renew",
      definition: "Of the customers whose plan came up for renewal, the share who stayed.",
      unit: "%",
      direction: "increase",
    },
    {
      name: "Support requests per 100 active people",
      definition: "How often people need help to get what they came for.",
      unit: "requests",
      direction: "decrease",
    },
  ],
  "unrealized-value": [
    {
      name: "Share of the people we aim at who use it",
      definition: "Of the people the product is meant for, the share who use it today.",
      unit: "%",
      direction: "increase",
    },
    {
      name: "Top needs we don't meet yet",
      definition: "How many of the needs customers ask for most the product can't meet today.",
      unit: "needs",
      direction: "decrease",
    },
    {
      name: "People who left for another product",
      definition:
        "Of the people who stopped using it, the share who said they moved to something else.",
      unit: "%",
      direction: "decrease",
    },
    {
      name: "Gap between wanted and got",
      definition:
        "How far people's rating of what they get falls short of how much it matters to them.",
      unit: "points",
      direction: "decrease",
    },
  ],
  "time-to-market": [
    {
      name: "Median cycle time",
      definition: "Half of the work finished in the last 90 days took this many days or fewer.",
      unit: "days",
      direction: "decrease",
      source: "cycle-time-median",
    },
    {
      name: "Lead time for changes",
      definition: "Days from a change being committed to it running in production.",
      unit: "days",
      direction: "decrease",
      source: "dora-lead-time",
    },
    {
      name: "Deploys a week",
      definition: "How often the team puts a change in front of people.",
      unit: "deploys",
      direction: "increase",
      source: "dora-deploys",
    },
    {
      name: "Days from idea to first feedback",
      definition: "How long it takes from deciding to try something to hearing what people think.",
      unit: "days",
      direction: "decrease",
    },
  ],
  "ability-to-innovate": [
    {
      name: "Open tech debt",
      definition: "The tech debt items still open: work that slows every new change.",
      unit: "items",
      direction: "decrease",
      source: "open-tech-debt",
    },
    {
      name: "Change failure rate",
      definition: "Of the changes deployed, the share that needed a fix or a rollback.",
      unit: "%",
      direction: "decrease",
      source: "dora-change-fail",
    },
    {
      name: "Sprint time on new work",
      definition: "The share of a sprint that went to new value, not upkeep or fixes.",
      unit: "%",
      direction: "increase",
    },
    {
      name: "Unplanned work per sprint",
      definition: "Points of work that arrived mid-sprint and pushed planned work aside.",
      unit: "points",
      direction: "decrease",
    },
  ],
};

const nameKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The area's idea of that name (spaces and case aside), so an accepted suggestion keeps its source. */
export function ideaNamed(area: EbmValueArea, name: string): MeasureIdea | undefined {
  const key = nameKey(name);
  return (MEASURE_IDEAS[area] ?? []).find((i) => nameKey(i.name) === key);
}

/**
 * The area's ideas without the names already in `existing`. When every
 * idea is there, the first one stays (the page reads it as already
 * there), so the answer is never empty.
 */
export function ideasFor(area: EbmValueArea, existing: readonly string[]): MeasureIdea[] {
  const all = MEASURE_IDEAS[area];
  if (!all) throw new Error("Pick a key value area first.");
  const taken = new Set(existing.map(nameKey));
  const left = all.filter((i) => !taken.has(nameKey(i.name)));
  return left.length > 0 ? [...left] : [all[0]];
}
