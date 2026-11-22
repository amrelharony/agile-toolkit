/**
 * Flow Insights' data-aware next steps. A stub while the tool is built
 * (tools plan, phase 2): its builder fills it, keeping this function and its
 * argument (lib/tools/next-steps.ts calls it). Pure: no store, no React, no
 * "use client" module.
 */

import type { CapacityPlan, KanbanBoard, Sprint, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface FlowInsightsStepsInput {
  stories: readonly Story[];
  sprints: readonly Sprint[];
  boards: readonly KanbanBoard[] | undefined;
  plans: readonly CapacityPlan[] | undefined;
}

/** Flow Insights' next steps. None until the tool is built. */
export function flowInsightsSteps(s: FlowInsightsStepsInput): NextStep[] {
  void s;
  return [];
}
