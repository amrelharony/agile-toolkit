/**
 * Value checks in the Hypothesis Tracker: a hypothesis that follows a
 * shipped story or epic asks whether the work delivered. The Hypothesis
 * Tracker's eager next-step rule (lib/tools/next-steps.ts) leaves value
 * checks out of its "Record the result" step and appends these steps
 * instead. `isValueCheck` is real; `valueCheckSteps` is a stub while P2.5
 * builds them, keeping these exports and their arguments. Imports only
 * ./model and types.
 */

import type { Hypothesis, Okr, ProductMetric } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** Whether a hypothesis is a value check: it follows a shipped story or epic. */
export function isValueCheck(h: Pick<Hypothesis, "shipped">): boolean {
  return h.shipped !== undefined;
}

/** What the value checks are read against: the product metrics and the OKRs. */
export interface ValueCheckSources {
  metrics: readonly ProductMetric[] | undefined;
  okrs: readonly Okr[];
}

/** The value checks' next steps, given today (YYYY-MM-DD). None until P2.5 builds them. */
export function valueCheckSteps(
  hypotheses: readonly Hypothesis[],
  sources: ValueCheckSources,
  today: string
): NextStep[] {
  void hypotheses;
  void sources;
  void today;
  return [];
}
