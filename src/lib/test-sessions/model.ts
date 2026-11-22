/**
 * Test Sessions' pure model, server-safe: the id prefix the CRUD mints, and
 * its next steps. A stub while the tool is built (tools plan, phase 2): its
 * builder fills it, keeping these exports and the steps function's shape
 * (lib/tools/next-steps.ts calls it). Pure: no store, no React, no "use
 * client" module.
 */

import type { TestSession } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** Every test session's id starts with this (the workspace.test_session CRUD's). */
export const TEST_SESSION_ID_PREFIX = "tsess_";

/** What the rule reads from the workspace. */
export interface TestSessionsStepsInput {
  sessions: readonly TestSession[] | undefined;
}

/** Test Sessions' next steps, given the time now. None until the tool is built. */
export function testSessionsSteps(s: TestSessionsStepsInput, now: Date): NextStep[] {
  void s;
  void now;
  return [];
}
