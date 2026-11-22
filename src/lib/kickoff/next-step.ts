/**
 * Kickoff's data-aware next steps. A stub while the tool is built (tools
 * plan, phase 2): its builder fills it, keeping this function and its
 * arguments (lib/tools/next-steps.ts calls it). Pure: no store, no React, no
 * "use client" module.
 */

import type {
  Kickoff,
  ProductGoal,
  Sprint,
  TeamMember,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface KickoffStepsInput {
  kickoffs: readonly Kickoff[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  agreements: readonly WorkingAgreement[] | undefined;
  members: readonly TeamMember[];
  sprints: readonly Sprint[];
}

/** Kickoff's next steps, given today (YYYY-MM-DD). None until the tool is built. */
export function kickoffNextSteps(s: KickoffStepsInput, today: string): NextStep[] {
  void s;
  void today;
  return [];
}
