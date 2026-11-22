/**
 * Hill Chart's pure model, server-safe: the id prefix the CRUD mints, and
 * its next steps. A stub while the tool is built (tools plan, phase 2): its
 * builder fills it, keeping these exports and the steps function's shape
 * (lib/tools/next-steps.ts calls it). Pure: no store, no React, no "use
 * client" module.
 */

import type { HillChart } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** Every hill chart's id starts with this (the workspace.hill_chart CRUD's). */
export const HILL_CHART_ID_PREFIX = "hill_";

/** What the rule reads from the workspace. */
export interface HillChartStepsInput {
  charts: readonly HillChart[] | undefined;
}

/** Hill Chart's next steps, given the time now. None until the tool is built. */
export function hillChartSteps(s: HillChartStepsInput, now: Date): NextStep[] {
  void s;
  void now;
  return [];
}
