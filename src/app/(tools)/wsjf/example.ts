import { exampleId } from "@/lib/utils/example-id";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";

type Parts = { businessValue: number; timeCriticality: number; rrOe: number; jobSize: number };

/**
 * A mobile checkout team's next PI, scored relatively: every column has a
 * 1 (the smallest in the set) and the others are sized against it. The
 * platform rebuild has the biggest business value but ranks last; the
 * small, urgent card-declined fix comes out on top, and the flaky login
 * test (tiny, and it unblocks the team) follows. Saved cards and address
 * autocomplete tie at 3.00, so the dense ranking shows.
 */
const ROWS: [string, Parts][] = [
  [
    "Rebuild checkout on the new payments platform",
    { businessValue: 20, timeCriticality: 1, rrOe: 13, jobSize: 20 },
  ],
  ["One-tap wallet checkout", { businessValue: 13, timeCriticality: 5, rrOe: 1, jobSize: 5 }],
  [
    "Fix card-declined message before the holiday sale",
    { businessValue: 8, timeCriticality: 13, rrOe: 3, jobSize: 2 },
  ],
  [
    "Saved cards for returning shoppers",
    { businessValue: 13, timeCriticality: 3, rrOe: 8, jobSize: 8 },
  ],
  ["Fix flaky login test", { businessValue: 1, timeCriticality: 2, rrOe: 8, jobSize: 1 }],
  ["Address autocomplete", { businessValue: 8, timeCriticality: 5, rrOe: 2, jobSize: 5 }],
];

/** The example rows, scored by the registry (example- ids, so Clear example removes them). */
export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const updatedAt = now.toISOString();
  return ROWS.map(([title, values], i) =>
    methodRow({ id: exampleId(`wsjf-${i + 1}`), framework: "wsjf", title, values, now: updatedAt })
  );
}
