/**
 * The EBM Dashboard's data-aware next steps (lib/tools/next-steps.ts calls
 * `ebmSteps` through its lazy rule). Examples are left out:
 *   1. no active Product Goal;
 *   2. a key value area with no measure;
 *   3. a measure read from the toolkit with no reading in 30 days (a DORA
 *      one: none since the last quarter's end), pointing at the tool it
 *      reads, since the rule can't see whether that tool has new data;
 *   4. no review in EBM_REVIEW_DAYS while two areas or more are measured;
 *   5. the weakest measured area with no running experiment.
 * Pure: no store, no React, no "use client" module.
 */

import {
  EBM_VALUE_AREAS,
  type EbmBoard,
  type HypothesisTracker,
  type MetricSourceId,
  type ProductGoal,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { activeGoal } from "@/lib/product-goal/model";
import { METRIC_STALE_DAYS, isStale, latestReading } from "@/lib/product-metrics/model";
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

/** DORA's numbers come one sample a quarter, dated at the quarter's end. */
const isQuarterly = (source: MetricSourceId) => source.startsWith("dora-");

/** The last day of the quarter before today's, or null without a real day. */
export function lastQuarterEnd(today: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = Math.floor((Number(m[2]) - 1) / 3);
  if (quarter === 0) return `${year - 1}-12-31`;
  return `${year}-${["03-31", "06-30", "09-30"][quarter - 1]}`;
}

/**
 * Whether a measure read from the toolkit is due a new reading: a DORA one
 * once a quarter has closed since its latest reading (a reading on the last
 * quarter's end is current, and the source can't give a newer one yet);
 * any other after METRIC_STALE_DAYS days.
 */
function sourceDue(m: ProductMetric, today: string): boolean {
  if (!m.source || !SOURCE_INFO[m.source]) return false;
  if (!isQuarterly(m.source)) return isStale(m, today);
  const latest = latestReading(m);
  const end = lastQuarterEnd(today);
  return !latest || (end !== null && latest.date < end);
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
  const due = EBM_VALUE_AREAS.flatMap((a) => byArea[a]).find((m) => sourceDue(m, today));
  if (due?.source) {
    const info = SOURCE_INFO[due.source];
    const end = lastQuarterEnd(today);
    steps.push({
      id: "ebm-source-reading",
      label: `Update ${due.name} from ${info.tool}`,
      detail: isQuarterly(due.source)
        ? `Its latest reading is from before ${end}, the last quarter's end. Log that quarter in ${info.tool}, then add the reading on the EBM Dashboard.`
        : `It has had no reading in ${METRIC_STALE_DAYS} days. Check ${info.tool} has new data, then add the reading on the EBM Dashboard.`,
      href: info.href,
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
