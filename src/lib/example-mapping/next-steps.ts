/**
 * Example Mapping's data-aware next steps. A stub while the tool is built
 * (tools plan, phase 2): its builder fills it, keeping this function and its
 * argument (lib/tools/next-steps.ts calls it). Pure: no store, no React, no
 * "use client" module.
 */

import type { ExampleMap, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface ExampleMappingStepsInput {
  maps: readonly ExampleMap[] | undefined;
  stories: readonly Story[];
}

/** Example Mapping's next steps. None until the tool is built. */
export function exampleMappingSteps(s: ExampleMappingStepsInput): NextStep[] {
  void s;
  return [];
}
