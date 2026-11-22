/**
 * Notes to Actions' pure model, server-safe: the id prefix the CRUD mints,
 * and its next steps. A stub while the tool is built (tools plan, phase 2):
 * its builder fills it, keeping these exports and the steps function's shape
 * (lib/tools/next-steps.ts calls it). Pure: no store, no React, no "use
 * client" module.
 */

import type { MeetingNote } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** Every meeting note's id starts with this (the workspace.meeting_note CRUD's). */
export const MEETING_NOTE_ID_PREFIX = "mnote_";

/** What the rule reads from the workspace. */
export interface NotesToActionsStepsInput {
  notes: readonly MeetingNote[] | undefined;
}

/** Notes to Actions' next steps, given the time now. None until the tool is built. */
export function notesToActionsSteps(s: NotesToActionsStepsInput, now: Date): NextStep[] {
  void s;
  void now;
  return [];
}
