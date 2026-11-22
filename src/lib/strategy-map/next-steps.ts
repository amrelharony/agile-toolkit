/**
 * Impact Map's and Strategy Tree's data-aware next steps. A stub while the
 * tools are built (tools plan, phase 2): their builder fills it, keeping
 * these functions and their arguments (lib/tools/next-steps.ts calls them).
 * Pure: no store, no React, no "use client" module.
 */

import type {
  EpicRoadmap,
  HypothesisTracker,
  Story,
  StrategyMap,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What Impact Map's rule reads from the workspace. */
export interface ImpactMapStepsInput {
  maps: readonly StrategyMap[] | undefined;
  stories: readonly Story[];
  roadmaps: readonly EpicRoadmap[] | undefined;
}

/** What Strategy Tree's rule reads from the workspace. */
export interface StrategyTreeStepsInput {
  maps: readonly StrategyMap[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
}

/** Impact Map's next steps. None until the tool is built. */
export function impactMapSteps(s: ImpactMapStepsInput): NextStep[] {
  void s;
  return [];
}

/** Strategy Tree's next steps, given the time now. None until the tool is built. */
export function strategyTreeSteps(s: StrategyTreeStepsInput, now: Date): NextStep[] {
  void s;
  void now;
  return [];
}
