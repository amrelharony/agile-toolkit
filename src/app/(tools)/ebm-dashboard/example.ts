/**
 * The EBM Dashboard's example: the same retro tool for remote teams as
 * Product Metrics', with a strategic goal, two measures in each key value
 * area (each with a target and three monthly readings; five read from the
 * toolkit) and two past reviews. Every row id is `exampleId("ebm-…")`, so
 * "Clear example" removes exactly these (and the example's goal, while it
 * is still its text) and never Product Metrics' rows.
 */

import type {
  EbmReview,
  EbmValueArea,
  MetricDirection,
  MetricSourceId,
  ProductMetric,
} from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";

export const EXAMPLE_STRATEGIC_GOAL = "Every remote team we serve improves one thing each sprint";
export const EXAMPLE_STRATEGIC_WHY =
  "Teams that follow up their retros ship better work, and they stay with us.";

function ago(today: string, n: number): string {
  const d = isoDayNumber(today);
  return d === null ? today : isoFromDayNumber(d - n);
}

interface Seed {
  key: string;
  area: EbmValueArea;
  name: string;
  definition: string;
  unit?: string;
  direction: MetricDirection;
  target: number;
  source?: MetricSourceId;
  values: [number, number, number];
}

const SEEDS: Seed[] = [
  {
    key: "nps",
    area: "current-value",
    name: "Net Promoter Score",
    definition: "How likely teams are to recommend the tool, from the last 90 days of answers.",
    direction: "increase",
    target: 40,
    source: "nps-90d",
    values: [18, 24, 31],
  },
  {
    key: "active-90",
    area: "current-value",
    name: "Teams still active after 90 days",
    definition: "Of the teams that started three months ago, the share still holding retros.",
    unit: "%",
    direction: "increase",
    target: 75,
    values: [61, 63, 66],
  },
  {
    key: "reach",
    area: "unrealized-value",
    name: "Remote teams we aim at who use it",
    definition: "Of the remote teams in the companies we sell to, the share using the tool.",
    unit: "%",
    direction: "increase",
    target: 15,
    values: [4, 5, 6],
  },
  {
    key: "needs",
    area: "unrealized-value",
    name: "Top team needs we don't meet yet",
    definition: "Of the ten things teams ask for most, how many the tool can't do today.",
    unit: "needs",
    direction: "decrease",
    target: 3,
    values: [9, 8, 7],
  },
  {
    key: "cycle",
    area: "time-to-market",
    name: "Median cycle time",
    definition: "Half the work finished in the last 90 days took this many days or fewer.",
    unit: "days",
    direction: "decrease",
    target: 3,
    source: "cycle-time-median",
    values: [6.5, 5.8, 4.9],
  },
  {
    key: "lead",
    area: "time-to-market",
    name: "Lead time for changes",
    definition: "Days from a change being committed to it running in production.",
    unit: "days",
    direction: "decrease",
    target: 1,
    source: "dora-lead-time",
    values: [3.2, 2.8, 2.1],
  },
  {
    key: "debt",
    area: "ability-to-innovate",
    name: "Open tech debt",
    definition: "Tech debt items still open: work that slows every new change.",
    unit: "items",
    direction: "decrease",
    target: 10,
    source: "open-tech-debt",
    values: [24, 21, 19],
  },
  {
    key: "change-fail",
    area: "ability-to-innovate",
    name: "Change failure rate",
    definition: "Of the changes deployed, the share that needed a fix or a rollback.",
    unit: "%",
    direction: "decrease",
    target: 10,
    source: "dora-change-fail",
    values: [18, 15, 12],
  },
];

export function buildEbmExample(
  today: string,
  now: string
): { metrics: ProductMetric[]; reviews: EbmReview[] } {
  const metrics = SEEDS.map((s) => ({
    id: exampleId(`ebm-${s.key}`),
    name: s.name,
    definition: s.definition,
    ...(s.unit ? { unit: s.unit } : {}),
    direction: s.direction,
    target: s.target,
    kva: s.area,
    ...(s.source ? { source: s.source } : {}),
    readings: s.values.map((value, i) => ({
      id: exampleId(`ebm-${s.key}-r${i + 1}`),
      date: ago(today, (2 - i) * 30),
      value,
    })),
    createdAt: now,
    updatedAt: now,
  }));
  const reviews: EbmReview[] = [
    {
      id: exampleId("ebm-review-1"),
      date: ago(today, 75),
      focus: "time-to-market",
      note: "Work waits days for review. Pair on reviews for a month.",
      areas: { "current-value": 0.21, "time-to-market": 0.08, "ability-to-innovate": 0.12 },
    },
    {
      id: exampleId("ebm-review-2"),
      date: ago(today, 35),
      focus: "unrealized-value",
      note: "We don't measure what teams ask for and can't get. Start counting it.",
      areas: {
        "current-value": 0.34,
        "unrealized-value": 0.17,
        "time-to-market": 0.29,
        "ability-to-innovate": 0.4,
      },
    },
  ];
  return { metrics, reviews };
}
