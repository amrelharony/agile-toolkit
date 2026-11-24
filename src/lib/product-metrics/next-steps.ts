/**
 * Product Metrics' data-aware next steps (lib/tools/next-steps.ts calls
 * `productMetricsSteps` through its lazy rule). Each leaves example rows
 * out and stays quiet when nothing applies:
 *   1. metrics but no North Star: pick one;
 *   2. the North Star or an input with no reading in METRIC_STALE_DAYS;
 *   3. the leakiest funnel stage with no running hypothesis measured by it;
 *   4. no active Product Goal.
 * Pure: no store, no React, no "use client" module.
 */

import type { HypothesisTracker, ProductGoal, ProductMetric } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { activeGoal } from "@/lib/product-goal/model";
import { isExampleId } from "@/lib/utils/example-id";
import {
  AARRR_LABEL,
  METRIC_STALE_DAYS,
  funnelView,
  isStale,
  northStarView,
  usableMetrics,
} from "./model";

/** What the rule reads from the workspace. */
export interface ProductMetricsStepsInput {
  metrics: readonly ProductMetric[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
}

/** The hypothesis tracker's page, opened on a new hypothesis for one metric. */
export const testFixHref = (metricId: string) =>
  `/hypothesis-tracker?metric=${encodeURIComponent(metricId)}`;

/** Product Metrics' next steps, given today (YYYY-MM-DD). */
export function productMetricsSteps(s: ProductMetricsStepsInput, today: string): NextStep[] {
  const metrics = usableMetrics(s.metrics, { withExamples: false });
  const steps: NextStep[] = [];
  const { northStar, inputs } = northStarView(metrics);
  if (metrics.length > 0 && !northStar) {
    steps.push({
      id: "product-metrics-north-star",
      label: "Pick your North Star",
      detail: `${metrics.length} ${metrics.length === 1 ? "metric is" : "metrics are"} tracked, but none is the one number the product lives by.`,
      href: "/product-metrics",
    });
  }
  const stale = [northStar, ...inputs].find((m): m is ProductMetric => !!m && isStale(m, today));
  if (stale) {
    steps.push({
      id: "product-metrics-reading",
      label: `Add this month's reading for ${stale.name}`,
      detail: `It has had no reading in ${METRIC_STALE_DAYS} days.`,
      href: "/product-metrics",
    });
  }
  const funnel = funnelView(metrics);
  const leak = funnel.leakiest ? funnel.stages.find((x) => x.stage === funnel.leakiest) : undefined;
  if (leak?.metric) {
    const metricId = leak.metric.id;
    const running = (s.trackers ?? [])
      .flatMap((t) => (Array.isArray(t?.hypotheses) ? t.hypotheses : []))
      .some(
        (h) =>
          h && !isExampleId(h.id) && h.status === "running" && h.measuredBy?.metricId === metricId
      );
    if (!running) {
      steps.push({
        id: "product-metrics-leak",
        label: `Test a fix for ${AARRR_LABEL[leak.stage]}`,
        detail: `${AARRR_LABEL[leak.stage]} loses the most people of the stage before, and no running hypothesis is measured by it.`,
        href: testFixHref(metricId),
      });
    }
  }
  if (!activeGoal(s.goals)) {
    steps.push({
      id: "product-metrics-goal",
      label: "Write the Product Goal",
      detail: "Metrics mean more against the goal the product works towards.",
      href: "/product-goal",
    });
  }
  return steps;
}
