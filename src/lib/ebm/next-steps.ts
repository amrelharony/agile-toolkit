/**
 * The EBM Dashboard's data-aware next steps. A stub while the tool is built
 * (tools plan, phase 2): its builder fills it, keeping this function and its
 * arguments (lib/tools/next-steps.ts calls it). Pure: no store, no React, no
 * "use client" module.
 */

import type {
  EbmBoard,
  HypothesisTracker,
  ProductGoal,
  ProductMetric,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface EbmStepsInput {
  boards: readonly EbmBoard[] | undefined;
  metrics: readonly ProductMetric[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
}

/** The EBM Dashboard's next steps, given today (YYYY-MM-DD). None until the tool is built. */
export function ebmSteps(s: EbmStepsInput, today: string): NextStep[] {
  void s;
  void today;
  return [];
}
