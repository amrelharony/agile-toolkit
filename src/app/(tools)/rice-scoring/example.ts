import { exampleId } from "@/components/tool-frame/example-data";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { riceScore } from "@/lib/analytics/scoring-rubric";

type Fields = { reach: number; impact: number; confidence: number; effort: number };

/**
 * A mobile checkout team's next quarter. The platform rebuild reaches the
 * most people but low confidence and a big effort pull it down; a half-month
 * fix to the card-declined message comes out on top. The rebuild ties with
 * address autocomplete, and the low-confidence AR idea trails far behind.
 */
const ROWS: [string, Fields][] = [
  [
    "Rebuild checkout on the new payments platform",
    { reach: 10000, impact: 3, confidence: 50, effort: 12 },
  ],
  ["Guest checkout without an account", { reach: 6000, impact: 1, confidence: 100, effort: 2 }],
  ["One-tap wallet checkout", { reach: 4000, impact: 2, confidence: 80, effort: 3 }],
  ["Clearer card-declined message", { reach: 2500, impact: 1, confidence: 80, effort: 0.5 }],
  ["Address autocomplete", { reach: 5000, impact: 0.5, confidence: 100, effort: 2 }],
  ["Saved cards for returning shoppers", { reach: 3000, impact: 2, confidence: 80, effort: 4 }],
  ["AR try-on for product photos", { reach: 1500, impact: 3, confidence: 50, effort: 6 }],
];

export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const updatedAt = now.toISOString();
  return ROWS.map(([title, fields], i) => ({
    id: exampleId(`rice-${i + 1}`),
    framework: "rice",
    title,
    score: riceScore(fields.reach, fields.impact, fields.confidence, fields.effort),
    fields,
    status: "scored",
    updatedAt,
  }));
}
