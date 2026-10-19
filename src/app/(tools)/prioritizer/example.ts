/**
 * Backlog Prioritizer — the example backlog.
 *
 * A mobile checkout team's next quarter, with inputs chosen so the methods
 * disagree: the platform rebuild is a Must and tops RICE on reach, yet
 * ranks near the bottom on WSJF; a half-sprint fix to the card-declined
 * message wins WSJF and is a quick win on the matrix.
 *
 * Ids start with `example-` so "Clear example" removes exactly these rows.
 * Older builds wrote a seed with `default:item-*` ids to every new backlog;
 * those count as example rows too, so people can clear them.
 */

import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import type { BacklogItem } from "./types";

const LEGACY_SEED_PREFIX = "default:item-";

export function isExampleBacklogId(id: string | null | undefined): boolean {
  return isExampleId(id) || (typeof id === "string" && id.startsWith(LEGACY_SEED_PREFIX));
}

type Inputs = Omit<BacklogItem, "id" | "name" | "value">;

const ROWS: [key: string, name: string, inputs: Inputs][] = [
  [
    "rebuild",
    "Rebuild checkout on the new payments platform",
    {
      moscow: "must",
      businessValue: 9,
      timeCriticality: 6,
      riskReduction: 8,
      jobSize: 9,
      reach: 10000,
      impact: 3,
      confidence: 50,
      effort: 12,
      matrixEffort: 9,
    },
  ],
  [
    "guest",
    "Guest checkout without an account",
    {
      moscow: "must",
      businessValue: 8,
      timeCriticality: 5,
      riskReduction: 2,
      jobSize: 3,
      reach: 6000,
      impact: 1,
      confidence: 100,
      effort: 2,
      matrixEffort: 3,
    },
  ],
  [
    "declined",
    "Clearer card-declined message",
    {
      moscow: "should",
      businessValue: 6,
      timeCriticality: 8,
      riskReduction: 3,
      jobSize: 2,
      reach: 2500,
      impact: 1,
      confidence: 80,
      effort: 0.5,
      matrixEffort: 2,
    },
  ],
  [
    "wallet",
    "One-tap wallet checkout",
    {
      moscow: "should",
      businessValue: 8,
      timeCriticality: 6,
      riskReduction: 2,
      jobSize: 5,
      reach: 4000,
      impact: 2,
      confidence: 80,
      effort: 3,
      matrixEffort: 5,
    },
  ],
  [
    "saved-cards",
    "Saved cards for returning shoppers",
    {
      moscow: "could",
      businessValue: 6,
      timeCriticality: 2,
      riskReduction: 4,
      jobSize: 5,
      reach: 3000,
      impact: 2,
      confidence: 80,
      effort: 4,
      matrixEffort: 6,
    },
  ],
  [
    "autocomplete",
    "Address autocomplete",
    {
      moscow: "could",
      businessValue: 4,
      timeCriticality: 3,
      riskReduction: 1,
      jobSize: 3,
      reach: 5000,
      impact: 0.5,
      confidence: 100,
      effort: 2,
      matrixEffort: 3,
    },
  ],
  [
    "ar",
    "AR try-on for product photos",
    {
      moscow: "wont",
      businessValue: 3,
      timeCriticality: 1,
      riskReduction: 1,
      jobSize: 8,
      reach: 1500,
      impact: 3,
      confidence: 20,
      effort: 6,
      matrixEffort: 8,
    },
  ],
];

/** The example backlog. The matrix value matches business value, as the "Value" column edits both. */
export function buildExample(): BacklogItem[] {
  return ROWS.map(([key, name, inputs]) => ({
    id: exampleId(`backlog-${key}`),
    name,
    ...inputs,
    value: inputs.businessValue,
  }));
}
