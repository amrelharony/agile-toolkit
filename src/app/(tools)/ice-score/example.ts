import { exampleId } from "@/lib/utils/example-id";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";
import { methodRow } from "@/lib/prioritization/binding";

type Scores = { impact: number; confidence: number; ease: number };

/**
 * A growth team's experiment backlog for trial-to-paid conversion. The
 * pricing-page rewrite has the biggest impact but little evidence; the
 * setup-checklist email is modest but proven and quick, so it comes out on
 * top. The two in-app nudges tie, and the referral programme trails because
 * it's slow to build.
 */
const ROWS: [string, Scores][] = [
  ["Setup-checklist email on day 1", { impact: 6, confidence: 8, ease: 9 }],
  ["Rewrite the pricing page around outcomes", { impact: 9, confidence: 4, ease: 6 }],
  ["In-app nudge when a trial hits its first limit", { impact: 7, confidence: 6, ease: 7 }],
  ["Trial-ending banner with a one-click upgrade", { impact: 6, confidence: 7, ease: 7 }],
  ["Annual-plan discount at checkout", { impact: 5, confidence: 7, ease: 8 }],
  ["Referral programme with account credits", { impact: 8, confidence: 5, ease: 3 }],
];

/** The example rows, scored by the registry (example- ids, so Clear example removes them). */
export function buildExample(now: Date = new Date()): PrioritizationItem[] {
  const updatedAt = now.toISOString();
  return ROWS.map(([title, values], i) =>
    methodRow({ id: exampleId(`ice-${i + 1}`), framework: "ice", title, values, now: updatedAt })
  );
}
