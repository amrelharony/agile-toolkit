/**
 * Improve's pure model, server-safe: the id prefix the CRUD mints, and its
 * next steps. A stub while the tool is built (tools plan, phase 2): its
 * builder fills it, keeping these exports and the steps function's shape
 * (lib/tools/next-steps.ts calls it). Pure: no store, no React, no "use
 * client" module.
 */

import type { Improvement, RetroBoard, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** Every improvement's id starts with this (the workspace.improvement CRUD's). */
export const IMPROVEMENT_ID_PREFIX = "improve_";

/** What the rule reads from the workspace. */
export interface ImproveStepsInput {
  items: readonly Improvement[] | undefined;
  boards: readonly RetroBoard[] | undefined;
  stories: readonly Story[];
}

/** Improve's next steps, given today (YYYY-MM-DD). None until the tool is built. */
export function improveSteps(s: ImproveStepsInput, today: string): NextStep[] {
  void s;
  void today;
  return [];
}
