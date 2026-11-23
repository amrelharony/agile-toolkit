/**
 * Product Canvas's data-aware next steps (lib/tools/next-steps.ts calls
 * `productCanvasSteps` with the workspace's canvases, goals and the
 * Hypothesis Tracker's document). Example canvases are left out.
 *
 *   1. product-canvas-goal:  canvases, but no active Product Goal to serve
 *   2. product-canvas-tests: lines the canvases sent that are still drafted
 *                            or running in the Hypothesis Tracker
 *
 * The idea inbox's and the betting table's steps come with their formats
 * (P2.3b). Pure: no store, no React, no "use client" module.
 */

import { HYPOTHESIS_TRACKER_ID, linkedTest } from "@/lib/hypotheses/model";
import { activeGoal } from "@/lib/product-goal/model";
import type { HypothesisTracker, ProductCanvas, ProductGoal } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { readCanvases } from "./model";

/** What the rule reads from the workspace. */
export interface ProductCanvasStepsInput {
  canvases: readonly ProductCanvas[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
  /** YYYY-MM-DD; the rule leaves it out (the inbox and betting-table steps read it). */
  today?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Product Canvas's next steps. */
export function productCanvasSteps(s: ProductCanvasStepsInput): NextStep[] {
  const canvases = readCanvases(s.canvases).filter((c) => !isExampleId(c.id));
  if (canvases.length === 0) return [];
  const steps: NextStep[] = [];
  if (!activeGoal(s.goals)) {
    steps.push({
      id: "product-canvas-goal",
      label: "Write the Product Goal these canvases serve",
      detail: `${plural(canvases.length, "canvas", "canvases")}, and no active Product Goal to draft from or check against.`,
      href: "/product-goal",
    });
  }
  const hypotheses = (s.trackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses;
  let testing = 0;
  for (const c of canvases) {
    for (const items of Object.values(c.sections)) {
      for (const item of items) {
        if (linkedTest(item.sentTo, hypotheses).state === "testing") testing++;
      }
    }
  }
  if (testing > 0) {
    steps.push({
      id: "product-canvas-tests",
      label: `Run the ${plural(testing, "test")} your canvases sent`,
      detail: `${testing === 1 ? "It is" : "They are"} still drafted or running in the Hypothesis Tracker.`,
      href: "/hypothesis-tracker",
    });
  }
  return steps;
}
