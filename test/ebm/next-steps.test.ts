// @vitest-environment node
/**
 * ebmSteps, called directly: each step, quiet when nothing applies,
 * examples left out; and the lazy rule reaches it.
 */

import { describe, expect, it } from "vitest";
import {
  EBM_BOARD_ID,
  emptyWorkspace,
  type EbmBoard,
  type EbmValueArea,
  type Hypothesis,
  type ProductGoal,
  type ProductMetric,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { ebmSteps } from "@/lib/ebm/next-steps";
import { getNextStepRule, loadNextStepRule } from "@/lib/tools/next-steps";
import { buildEbmExample } from "@/app/(tools)/ebm-dashboard/example";

const NOW = "2026-11-20T10:00:00.000Z";
const TODAY = "2026-11-20";

const goal: ProductGoal = {
  id: "goal_a",
  statement: "Teams improve every sprint",
  measures: [],
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
};
const measure = (id: string, kva: EbmValueArea, value: number, over: Partial<ProductMetric> = {}) =>
  ({
    id,
    name: id,
    direction: "increase",
    baseline: 0,
    target: 10,
    kva,
    readings: [{ id: `${id}-r`, date: TODAY, value }],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as ProductMetric;
const all = () => [
  measure("cv", "current-value", 8),
  measure("uv", "unrealized-value", 6),
  measure("ttm", "time-to-market", 2),
  measure("ai", "ability-to-innovate", 7),
];
const board = (reviews: EbmBoard["reviews"]): EbmBoard[] => [
  { id: EBM_BOARD_ID, reviews, createdAt: NOW, updatedAt: NOW },
];
const recent = board([{ id: "review_1", date: "2026-11-10", focus: "time-to-market", areas: {} }]);
const running = (metricId: string): Hypothesis => ({
  id: "h1",
  believe: "Smaller batches",
  willDo: "x",
  toLearn: "y",
  successMetric: "z",
  status: "running",
  raisedAt: TODAY,
  measuredBy: { kind: "metric", metricId },
});
const trackers = (hs: Hypothesis[]) => [{ id: "hypothesisTracker:current", hypotheses: hs }];

const ids = (s: Parameters<typeof ebmSteps>[0]) => ebmSteps(s, TODAY).map((x) => x.id);

describe("ebmSteps", () => {
  it("is quiet when every area is measured, reviewed and experimented on", () => {
    expect(
      ids({ boards: recent, metrics: all(), goals: [goal], trackers: trackers([running("ttm")]) })
    ).toEqual([]);
  });

  it("points at the Product Goal, then an area with no measure", () => {
    const steps = ebmSteps({ boards: [], metrics: [], goals: [], trackers: [] }, TODAY);
    expect(steps.map((s) => s.id)).toEqual(["ebm-product-goal", "ebm-area-measure"]);
    expect(steps[1].label).toBe("Add a measure for Current Value");
  });

  it("asks for this month's reading of a sourced measure", () => {
    const stale = measure("cycle", "time-to-market", 5, {
      source: "cycle-time-median",
      readings: [{ id: "r", date: "2026-09-01", value: 5 }],
    });
    const steps = ebmSteps(
      {
        boards: recent,
        metrics: [...all(), stale],
        goals: [goal],
        trackers: trackers([running("ttm")]),
      },
      TODAY
    );
    expect(steps.map((s) => s.label)).toEqual([
      "Add this month's reading for cycle from Cycle Time",
    ]);
  });

  it("asks for a review when two areas are measured and none is recent", () => {
    const old = board([{ id: "review_1", date: "2026-09-01", focus: "current-value", areas: {} }]);
    expect(
      ids({ boards: old, metrics: all(), goals: [goal], trackers: trackers([running("ttm")]) })
    ).toEqual(["ebm-review"]);
    expect(
      ids({ boards: [], metrics: all().slice(0, 1), goals: [goal], trackers: [] })
    ).not.toContain("ebm-review");
  });

  it("asks for an experiment on the weakest area", () => {
    const steps = ebmSteps({ boards: recent, metrics: all(), goals: [goal], trackers: [] }, TODAY);
    const step = steps.find((s) => s.id === "ebm-experiment");
    expect(step?.label).toBe("Run an experiment for Time to Market");
    expect(step?.href).toBe("/hypothesis-tracker?metric=ttm");
  });

  it("leaves the example's measures and reviews out", () => {
    const ex = buildEbmExample(TODAY, NOW);
    const steps = ids({
      boards: board(ex.reviews),
      metrics: ex.metrics,
      goals: [goal],
      trackers: [],
    });
    expect(steps).toEqual(["ebm-area-measure"]);
  });
});

describe("the lazy rule", () => {
  it("loads this module and reads the workspace", async () => {
    await loadNextStepRule("ebm-dashboard");
    const rule = getNextStepRule("ebm-dashboard")!;
    const ws = { ...emptyWorkspace, productGoals: [goal] } as Workspace;
    expect(rule.steps(rule.select(ws)).map((s) => s.id)).toEqual(["ebm-area-measure"]);
  });
});
