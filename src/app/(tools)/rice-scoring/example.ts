import { exampleId } from "@/lib/utils/example-id";
import type { PrioritizationItem, ReachPeriod } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";

type Inputs = {
  reach: number;
  reachPeriod: ReachPeriod;
  impact: number;
  confidence: number;
  effort: number;
};

/**
 * A mobile checkout team's next quarter. The platform rebuild reaches the
 * most people but low confidence and a big effort pull it down; a half-month
 * fix to the card-declined message comes out on top. The rebuild ties with
 * address autocomplete, and the low-confidence AR idea trails far behind.
 * Guest checkout's reach is counted per month (2,000 a month is 6,000 a
 * quarter), so the example shows a period other than a quarter.
 */
const ROWS: [string, Inputs][] = [
  [
    "Rebuild checkout on the new payments platform",
    { reach: 10000, reachPeriod: "quarter", impact: 3, confidence: 50, effort: 12 },
  ],
  [
    "Guest checkout without an account",
    { reach: 2000, reachPeriod: "month", impact: 1, confidence: 100, effort: 2 },
  ],
  [
    "One-tap wallet checkout",
    { reach: 4000, reachPeriod: "quarter", impact: 2, confidence: 80, effort: 3 },
  ],
  [
    "Clearer card-declined message",
    { reach: 2500, reachPeriod: "quarter", impact: 1, confidence: 80, effort: 0.5 },
  ],
  [
    "Address autocomplete",
    { reach: 5000, reachPeriod: "quarter", impact: 0.5, confidence: 100, effort: 2 },
  ],
  [
    "Saved cards for returning shoppers",
    { reach: 3000, reachPeriod: "quarter", impact: 2, confidence: 80, effort: 4 },
  ],
  [
    "AR try-on for product photos",
    { reach: 1500, reachPeriod: "quarter", impact: 3, confidence: 50, effort: 6 },
  ],
];

/** The example rows, scored by the registry (example- ids, so Clear example removes them). */
export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const updatedAt = now.toISOString();
  return ROWS.map(([title, values], i) =>
    methodRow({ id: exampleId(`rice-${i + 1}`), framework: "rice", title, values, now: updatedAt })
  );
}
