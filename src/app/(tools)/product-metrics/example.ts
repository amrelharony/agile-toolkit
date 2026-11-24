/**
 * Product Metrics' example: a retro tool for remote teams. Its North Star
 * has eight weekly readings rising from 42 to 58 towards a target of 80
 * (42% of the way); three inputs; HEART goals for "Action follow-up"; and
 * three months of the funnel, where Activation (35% of sign-ups, up from
 * 34%) is the leakiest stage. Every id is `exampleId("pm-…")`, so "Clear
 * example" removes exactly these rows and never the EBM Dashboard's.
 */

import type { MetricReading, ProductMetric } from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";

/** The day `n` days before `today`. */
function ago(today: string, n: number): string {
  const d = isoDayNumber(today);
  return d === null ? today : isoFromDayNumber(d - n);
}

function readings(key: string, today: string, series: [number, number][]): MetricReading[] {
  return series.map(([daysAgo, value], i) => ({
    id: exampleId(`pm-${key}-r${i + 1}`),
    date: ago(today, daysAgo),
    value,
  }));
}

const weekly = (values: number[]): [number, number][] =>
  values.map((v, i) => [(values.length - 1 - i) * 7, v]);
const monthly = (values: number[]): [number, number][] =>
  values.map((v, i) => [(values.length - 1 - i) * 30, v]);

export function buildExample(today: string, now: string): ProductMetric[] {
  const row = (
    key: string,
    fields: Omit<ProductMetric, "id" | "readings" | "createdAt" | "updatedAt">,
    series: [number, number][]
  ): ProductMetric => ({
    id: exampleId(`pm-${key}`),
    ...fields,
    readings: readings(key, today, series),
    createdAt: now,
    updatedAt: now,
  });
  return [
    row(
      "north-star",
      {
        name: "Teams that hold a retro each week",
        definition: "Remote teams that ran at least one retro in the week and agreed an action.",
        unit: "teams",
        direction: "increase",
        target: 80,
        owner: "Maya",
        role: "north-star",
      },
      weekly([42, 44, 43, 47, 50, 52, 55, 58])
    ),
    row(
      "first-retro",
      {
        name: "New teams that run a first retro",
        definition: "Teams that signed up and held their first retro in the same week.",
        unit: "teams",
        direction: "increase",
        target: 20,
        owner: "Sam",
        role: "input",
      },
      [
        [14, 9],
        [7, 11],
        [0, 12],
      ]
    ),
    row(
      "retros-per-team",
      {
        name: "Retros per active team",
        definition: "Retros an active team holds in four weeks.",
        unit: "retros",
        direction: "increase",
        baseline: 2.1,
        target: 3.5,
        owner: "Lea",
        role: "input",
      },
      [
        [14, 2.3],
        [7, 2.4],
        [0, 2.6],
      ]
    ),
    row(
      "actions-closed",
      {
        name: "Actions closed by the next retro",
        definition: "Of the actions a retro agrees, the share closed before the next one.",
        unit: "%",
        direction: "increase",
        target: 70,
        owner: "Maya",
        role: "input",
      },
      [
        [14, 38],
        [7, 41],
        [0, 45],
      ]
    ),
    row(
      "heart-happiness",
      {
        name: "Teams who rate follow-up 4 or 5",
        unit: "%",
        direction: "increase",
        target: 75,
        heart: {
          category: "happiness",
          feature: "Action follow-up",
          goal: "Teams find following up easy.",
          signal: "They rate it well after a retro.",
        },
      },
      [
        [28, 58],
        [0, 64],
      ]
    ),
    row(
      "heart-adoption",
      {
        name: "Teams that assign an owner to an action",
        unit: "%",
        direction: "increase",
        target: 60,
        heart: {
          category: "adoption",
          feature: "Action follow-up",
          goal: "Teams start tracking their actions.",
          signal: "Each action gets an owner.",
        },
      },
      [
        [28, 31],
        [0, 39],
      ]
    ),
    row(
      "heart-task",
      {
        name: "Actions closed without a reminder",
        unit: "%",
        direction: "increase",
        target: 50,
        heart: {
          category: "task-success",
          feature: "Action follow-up",
          goal: "Owners close actions on their own.",
          signal: "No nudge needed before the next retro.",
        },
      },
      [
        [28, 22],
        [0, 27],
      ]
    ),
    row(
      "acquisition",
      { name: "Visitors who sign up", unit: "people", direction: "increase", aarrr: "acquisition" },
      monthly([3600, 3800, 4000])
    ),
    row(
      "activation",
      {
        name: "Sign-ups who run a first retro",
        unit: "people",
        direction: "increase",
        aarrr: "activation",
      },
      monthly([1150, 1290, 1400])
    ),
    row(
      "retention",
      {
        name: "Teams back for a second retro",
        unit: "people",
        direction: "increase",
        aarrr: "retention",
      },
      monthly([560, 630, 700])
    ),
    row(
      "referral",
      {
        name: "People who invite a team",
        unit: "people",
        direction: "increase",
        aarrr: "referral",
      },
      monthly([90, 105, 120])
    ),
    row(
      "revenue",
      { name: "Teams that pay", unit: "people", direction: "increase", aarrr: "revenue" },
      monthly([70, 80, 90])
    ),
  ];
}
