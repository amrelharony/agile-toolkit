/**
 * The A/B Calculator's data-aware next steps. A stub while the tool is built
 * (tools plan, phase 2): its builder fills it, keeping this function and its
 * arguments (lib/tools/next-steps.ts calls it). Pure: no store, no React, no
 * "use client" module.
 */

import type { AbTest, HypothesisTracker } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface AbCalculatorStepsInput {
  tests: readonly AbTest[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
}

/** The A/B Calculator's next steps, given today (YYYY-MM-DD). None until the tool is built. */
export function abCalculatorSteps(s: AbCalculatorStepsInput, today: string): NextStep[] {
  void s;
  void today;
  return [];
}
