/**
 * Backlog Prioritizer — the example backlog.
 *
 * A mobile checkout team's next quarter, with inputs chosen so the methods
 * disagree and Decide order has something to do: the platform rebuild is a
 * Must with by far the most reach, yet ranks near the bottom on WSJF; a
 * half-sprint fix to the card-declined message wins WSJF and RICE and is a
 * quick win on the matrix. Nothing is ordered yet, and the backlog is
 * scored the way a real one is, unevenly: nobody has sized the AR try-on's
 * reach (Not scored on RICE), saved cards has no effort for the matrix
 * (Not placed yet), and the dark-mode receipts idea isn't scored in any
 * method. Address autocomplete and the rebuild tie on RICE.
 *
 * Every WSJF part, and the one value field (businessValue, which the
 * Value/Effort matrix reads too), is on the Fibonacci scale 1, 2, 3, 5, 8,
 * 13, 20, so nothing reads as Custom. The items are made through
 * createBacklogItem, stamped as saved by the new code: a deliberate
 * "should" reads as chosen, not as the old "Add item" default
 * (lib/prioritization/defaults).
 *
 * Ids start with `example-` so "Clear example" removes exactly these rows.
 * Older builds wrote a seed with `default:item-*` ids to every new backlog;
 * those count as example rows too, so people can clear them.
 */

import { exampleId, isExampleId } from "@/lib/utils/example-id";
import { createBacklogItem } from "@/lib/prioritization/frameworks";
import type { BacklogItem } from "./types";

const LEGACY_SEED_PREFIX = "default:item-";

export function isExampleBacklogId(id: string | null | undefined): boolean {
  return isExampleId(id) || (typeof id === "string" && id.startsWith(LEGACY_SEED_PREFIX));
}

type Inputs = Omit<BacklogItem, "id" | "name" | "value" | "updatedAt" | "rank">;

const ROWS: [key: string, name: string, inputs: Inputs][] = [
  [
    "rebuild",
    "Rebuild checkout on the new payments platform",
    {
      moscow: "must",
      businessValue: 8,
      timeCriticality: 5,
      riskReduction: 8,
      jobSize: 13,
      reach: 10000,
      reachPeriod: "quarter",
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
      reach: 2000,
      reachPeriod: "month",
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
      businessValue: 8,
      timeCriticality: 8,
      riskReduction: 3,
      jobSize: 2,
      reach: 2500,
      reachPeriod: "quarter",
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
      timeCriticality: 5,
      riskReduction: 2,
      jobSize: 5,
      reach: 4000,
      reachPeriod: "quarter",
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
      businessValue: 5,
      timeCriticality: 2,
      riskReduction: 3,
      jobSize: 5,
      reach: 3000,
      reachPeriod: "quarter",
      impact: 2,
      confidence: 80,
      effort: 4,
    },
  ],
  [
    "autocomplete",
    "Address autocomplete",
    {
      moscow: "could",
      businessValue: 3,
      timeCriticality: 3,
      riskReduction: 1,
      jobSize: 3,
      reach: 5000,
      reachPeriod: "quarter",
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
      matrixEffort: 8,
    },
  ],
  ["receipts", "Email receipts in dark mode", {}],
];

/** The example backlog, stamped now (see the header). Nothing is ordered. */
export function buildExample(now: string = new Date().toISOString()): BacklogItem[] {
  return ROWS.map(([key, name, inputs]) =>
    createBacklogItem(name, inputs, exampleId(`backlog-${key}`), now)
  );
}
