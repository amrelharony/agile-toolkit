/**
 * The Persona Library's data-aware next steps. A stub while the tool is
 * built (tools plan, phase 2): its builder fills it, keeping this function
 * and its argument (lib/tools/next-steps.ts calls it). Pure: no store, no
 * React, no "use client" module.
 */

import type { Persona, StrategyMap, UserInterviewLog } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface PersonaStepsInput {
  personas: readonly Persona[] | undefined;
  maps: readonly StrategyMap[] | undefined;
  logs: readonly UserInterviewLog[] | undefined;
}

/** The Persona Library's next steps. None until the tool is built. */
export function personaSteps(s: PersonaStepsInput): NextStep[] {
  void s;
  return [];
}
