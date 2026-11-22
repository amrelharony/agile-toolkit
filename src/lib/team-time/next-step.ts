/**
 * Team Time's data-aware next steps. A stub while the tool is built (tools
 * plan, phase 2): its builder fills it, keeping this function and its
 * arguments (lib/tools/next-steps.ts calls it). Pure: no store, no React, no
 * "use client" module.
 */

import type {
  CeremonyCadenceDoc,
  TeamMember,
  TeamTimePerson,
  TeamTimePoll,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface TeamTimeStepsInput {
  people: readonly TeamTimePerson[] | undefined;
  members: readonly TeamMember[];
  cadences: readonly CeremonyCadenceDoc[] | undefined;
  agreements: readonly WorkingAgreement[] | undefined;
  polls: readonly TeamTimePoll[] | undefined;
}

/** Team Time's next steps, given the time now and the viewer's time zone. None until the tool is built. */
export function teamTimeSteps(s: TeamTimeStepsInput, now: Date, timeZone: string): NextStep[] {
  void s;
  void now;
  void timeZone;
  return [];
}
