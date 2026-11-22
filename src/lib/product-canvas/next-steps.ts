/**
 * Product Canvas's data-aware next steps. A stub while the tool is built
 * (tools plan, phase 2): its builder fills it, keeping this function and its
 * argument (lib/tools/next-steps.ts calls it). Pure: no store, no React, no
 * "use client" module.
 */

import type { HypothesisTracker, ProductCanvas, ProductGoal } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface ProductCanvasStepsInput {
  canvases: readonly ProductCanvas[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
  /** YYYY-MM-DD; the rule leaves it out (its builder may pass one in tests). */
  today?: string;
}

/** Product Canvas's next steps. None until the tool is built. */
export function productCanvasSteps(s: ProductCanvasStepsInput): NextStep[] {
  void s;
  return [];
}
