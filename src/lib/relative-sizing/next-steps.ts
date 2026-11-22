/**
 * Relative Sizing's data-aware next steps. A stub while the tool is built
 * (tools plan, phase 2): its builder fills it, keeping this function and its
 * argument (lib/tools/next-steps.ts calls it). Pure: no store, no React, no
 * "use client" module.
 */

import type { Sprint, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface RelativeSizingStepsInput {
  stories: readonly Story[];
  sprints: readonly Sprint[];
}

/** Relative Sizing's next steps. None until the tool is built. */
export function relativeSizingSteps(s: RelativeSizingStepsInput): NextStep[] {
  void s;
  return [];
}
