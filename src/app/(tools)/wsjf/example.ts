import { exampleId } from "@/components/tool-frame/example-data";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { wsjfScore } from "@/lib/analytics/scoring-rubric";

type Fields = { businessValue: number; timeCriticality: number; rrOe: number; jobSize: number };

/**
 * A mobile checkout team's next PI. The platform rebuild has the biggest
 * business value but ranks last: small, urgent fixes beat a big job on
 * WSJF. Two features tie at 3.00.
 */
const ROWS: [string, Fields][] = [
  [
    "Rebuild checkout on the new payments platform",
    { businessValue: 20, timeCriticality: 8, rrOe: 13, jobSize: 20 },
  ],
  ["One-tap wallet checkout", { businessValue: 13, timeCriticality: 8, rrOe: 3, jobSize: 5 }],
  [
    "Fix card-declined message before the holiday sale",
    { businessValue: 8, timeCriticality: 13, rrOe: 3, jobSize: 2 },
  ],
  [
    "Saved cards for returning shoppers",
    { businessValue: 13, timeCriticality: 3, rrOe: 8, jobSize: 8 },
  ],
  ["Fix flaky login test", { businessValue: 3, timeCriticality: 5, rrOe: 8, jobSize: 2 }],
  ["Address autocomplete", { businessValue: 8, timeCriticality: 5, rrOe: 2, jobSize: 5 }],
];

export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const updatedAt = now.toISOString();
  return ROWS.map(([title, fields], i) => ({
    id: exampleId(`wsjf-${i + 1}`),
    framework: "wsjf",
    title,
    score: wsjfScore(fields.businessValue, fields.timeCriticality, fields.rrOe, fields.jobSize),
    fields,
    status: "scored",
    updatedAt,
  }));
}
