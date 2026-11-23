/**
 * The EBM Dashboard's data-aware next steps (lib/tools/next-steps.ts calls
 * `ebmSteps` through its lazy rule). Examples are left out:
 *   1. no active Product Goal;
 *   2. a key value area with no measure;
 *   3. a measure read from the toolkit with no reading in 30 days;
 *   4. no review in EBM_REVIEW_DAYS while two areas or more are measured;
 *   5. the weakest measured area with no running experiment.
 * Pure: no store, no React, no "use client" module.
 */

import {
  EBM_VALUE_AREAS,
  type EbmBoard,
  type HypothesisTracker,
  type ProductGoal,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { activeGoal } from "@/lib/product-goal/model";
import { METRIC_STALE_DAYS, isStale } from "@/lib/product-metrics/model";
import { testFixHref } from "@/lib/product-metrics/next-steps";
import {
  AREA_LABEL,
  EBM_REVIEW_DAYS,
  areaScores,
  daysSinceReview,
  experimentsFor,
  hypothesesOf,
  measuresByArea,
  readBoard,
  weakestArea,
  weakestMeasure,
} from "./model";
import { SOURCE_INFO } from "./source-info";

/** What the rule reads from the workspace. */
export interface EbmStepsInput {
  boards: readonly EbmBoard[] | undefined;
  metrics: readonly ProductMetric[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
}

/** The EBM Dashboard's next steps, given today (YYYY-MM-DD). */
export function ebmSteps(s: EbmStepsInput, today: string): NextStep[] {
  const steps: NextStep[] = [];
  if (!activeGoal(s.goals)) {
    steps.push({
      id: "ebm-product-goal",
      label: "Write the Product Goal",
      detail: "It is the intermediate goal between your strategic goal and each sprint's.",
      href: "/product-goal",
    });
  }
  const byArea = measuresByArea(s.metrics, { withExamples: false });
  const empty = EBM_VALUE_AREAS.find((a) => byArea[a].length === 0);
  if (empty) {
    steps.push({
      id: "ebm-area-measure",
      label: `Add a measure for ${AREA_LABEL[empty]}`,
      detail: "Each key value area needs at least one measure.",
      href: "/ebm-dashboard",
    });
  }
  const staleSourced = EBM_VALUE_AREAS.flatMap((a) => byArea[a]).find(
    (m) => m.source && SOURCE_INFO[m.source] && isStale(m, today)
  );
  if (staleSourced?.source) {
    steps.push({
      id: "ebm-source-reading",
      label: `Add this month's reading for ${staleSourced.name} from ${SOURCE_INFO[staleSourced.source].tool}`,
      detail: `It has had no reading in ${METRIC_STALE_DAYS} days.`,
      href: "/ebm-dashboard",
    });
  }
  const scores = areaScores(byArea);
  const measured = EBM_VALUE_AREAS.filter((a) => scores[a] !== undefined).length;
  const board = readBoard(s.boards);
  const real = board
    ? { ...board, reviews: board.reviews.filter((r) => !r.id.startsWith("example-")) }
    : null;
  const since = daysSinceReview(real, today);
  if (measured >= 2 && (since === null || since >= EBM_REVIEW_DAYS)) {
    steps.push({
      id: "ebm-review",
      label: "Hold an EBM review",
      detail:
        since === null
          ? `${measured} areas are measured and there has been no review yet.`
          : `The last review was ${since} days ago.`,
      href: "/ebm-dashboard",
    });
  }
  const weakest = weakestArea(scores);
  if (weakest) {
    const measures = byArea[weakest];
    const running = experimentsFor(
      measures,
      hypothesesOf(s.trackers, { withExamples: false })
    ).some((e) => e.hypothesis.status === "running");
    const target = weakestMeasure(measures);
    if (!running && target) {
      steps.push({
        id: "ebm-experiment",
        label: `Run an experiment for ${AREA_LABEL[weakest]}`,
        detail: `It is the weakest area, and no running hypothesis is measured by its measures.`,
        href: testFixHref(target.id),
      });
    }
  }
  return steps;
}
