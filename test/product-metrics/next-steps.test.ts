// @vitest-environment node
/**
 * productMetricsSteps, called directly (as next-steps-phase42 does): each
 * step, quiet when nothing applies, examples left out; and the lazy rule
 * reaches it.
 */

import { describe, expect, it } from "vitest";
import type {
  Hypothesis,
  HypothesisTracker,
  ProductGoal,
  ProductMetric,
} from "@/lib/stores/workspace-types";
import { emptyWorkspace, type Workspace } from "@/lib/stores/workspace-types";
import { productMetricsSteps } from "@/lib/product-metrics/next-steps";
import { getNextStepRule, loadNextStepRule } from "@/lib/tools/next-steps";
import { buildExample } from "@/app/(tools)/product-metrics/example";

const NOW = "2026-11-20T10:00:00.000Z";
const TODAY = "2026-11-20";

const metric = (over: Partial<ProductMetric>): ProductMetric => ({
  id: "metric_a",
  name: "Metric",
  direction: "increase",
  readings: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const goal: ProductGoal = {
  id: "goal_a",
  statement: "Teams improve every sprint",
  measures: [],
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
};
const tracker = (hypotheses: Hypothesis[]): HypothesisTracker[] => [
  { id: "hypothesisTracker:current", hypotheses },
];

/** The example's funnel as the team's own rows. */
const ownFunnel = () =>
  buildExample(TODAY, NOW)
    .filter((m) => m.aarrr)
    .map((m) => ({ ...m, id: m.id.replace("example-pm-", "metric_") }));

const ids = (s: Parameters<typeof productMetricsSteps>[0]) =>
  productMetricsSteps(s, TODAY).map((x) => x.id);

describe("productMetricsSteps", () => {
  it("is quiet with a goal and nothing else to do", () => {
    expect(ids({ metrics: [], goals: [goal], trackers: [] })).toEqual([]);
  });

  it("asks for a North Star when metrics have none", () => {
    expect(ids({ metrics: [metric({})], goals: [goal], trackers: [] })).toEqual([
      "product-metrics-north-star",
    ]);
  });

  it("asks for this month's reading of a stale North Star or input", () => {
    const steps = productMetricsSteps(
      {
        metrics: [
          metric({
            id: "metric_ns",
            role: "north-star",
            readings: [{ id: "r", date: TODAY, value: 1 }],
          }),
          metric({
            id: "metric_in",
            name: "Retros a team",
            role: "input",
            readings: [{ id: "r", date: "2026-10-01", value: 1 }],
          }),
        ],
        goals: [goal],
        trackers: [],
      },
      TODAY
    );
    expect(steps.map((s) => s.id)).toEqual(["product-metrics-reading"]);
    expect(steps[0].label).toBe("Add this month's reading for Retros a team");
  });

  it("asks to test a fix for the leakiest stage until a running hypothesis measures it", () => {
    const funnel = ownFunnel();
    const steps = productMetricsSteps({ metrics: funnel, goals: [goal], trackers: [] }, TODAY);
    const leak = steps.find((s) => s.id === "product-metrics-leak");
    expect(leak?.label).toBe("Test a fix for Activation");
    expect(leak?.href).toBe("/hypothesis-tracker?metric=metric_activation");
    const running: Hypothesis = {
      id: "h1",
      believe: "A shorter setup",
      willDo: "x",
      toLearn: "y",
      successMetric: "z",
      status: "running",
      raisedAt: TODAY,
      measuredBy: { kind: "metric", metricId: "metric_activation" },
    };
    expect(ids({ metrics: funnel, goals: [goal], trackers: tracker([running]) })).not.toContain(
      "product-metrics-leak"
    );
    expect(
      ids({
        metrics: funnel,
        goals: [goal],
        trackers: tracker([{ ...running, status: "drafted" }]),
      })
    ).toContain("product-metrics-leak");
  });

  it("points at the Product Goal when none is active", () => {
    expect(ids({ metrics: [], goals: [], trackers: [] })).toEqual(["product-metrics-goal"]);
  });

  it("leaves the example's rows out", () => {
    expect(ids({ metrics: buildExample(TODAY, NOW), goals: [goal], trackers: [] })).toEqual([]);
  });
});

describe("the lazy rule", () => {
  it("loads this module and reads the workspace", async () => {
    await loadNextStepRule("product-metrics");
    const rule = getNextStepRule("product-metrics")!;
    const ws = {
      ...emptyWorkspace,
      productMetrics: [metric({})],
      productGoals: [goal],
    } as Workspace;
    expect(rule.steps(rule.select(ws)).map((s) => s.id)).toEqual(["product-metrics-north-star"]);
  });
});
