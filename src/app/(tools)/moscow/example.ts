import { exampleId } from "@/lib/utils/example-id";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";
import type { MoscowBucket } from "@/lib/prioritization/methods/moscow";

/**
 * A mobile checkout team's release scope, each item with a rough effort in
 * points. The Musts take 18 of the 26 planned points (69%), over the ~60%
 * limit, so the budget bar shows what an over-full Must list looks like;
 * Apple Pay has no effort yet, so the bar names it; the crypto payments
 * idea is a Won't and stays out of the plan.
 */
const ROWS: [string, MoscowBucket, number | undefined][] = [
  ["Card payments through the new provider", "must", 8],
  ["Order confirmation email", "must", 2],
  ["Fraud checks on high-value orders", "must", 5],
  ["Accessibility fixes on the payment form", "must", 3],
  ["Guest checkout", "should", 3],
  ["Saved delivery addresses", "should", 2],
  ["Apple Pay", "should", undefined],
  ["Gift wrapping option", "could", 1],
  ["Dark mode on checkout", "could", 2],
  ["Crypto payments", "wont", 8],
];

/** The example rows, scored by the registry (example- ids, so Clear example removes them). */
export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const updatedAt = now.toISOString();
  return ROWS.map(([title, bucket, effort], i) =>
    methodRow({
      id: exampleId(`moscow-${i + 1}`),
      framework: "moscow",
      title,
      values: { bucket, effort },
      now: updatedAt,
    })
  );
}
