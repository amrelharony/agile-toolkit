/**
 * Bug Triage's pure model, server-safe: the bug id prefix the hand-off
 * route and the CRUD share, and its next steps. A stub while the tool is
 * built (tools plan, phase 2); its builder fills it, keeping these exports
 * and the steps function's shape (lib/tools/next-steps.ts calls it).
 */

import type { BugReport, InterruptItem, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** Every bug's id starts with this (the CRUD's and the "bug" route's). */
export const BUG_ID_PREFIX = "bug_";

/** What Bug Triage's next-step rule reads from the workspace. */
export interface BugTriageStepsInput {
  bugs: readonly BugReport[] | undefined;
  stories: readonly Story[];
  interrupts: readonly InterruptItem[] | undefined;
}

/** Bug Triage's next steps, given today (YYYY-MM-DD). None until the tool is built. */
export function bugTriageSteps(s: BugTriageStepsInput, today: string): NextStep[] {
  void s;
  void today;
  return [];
}
