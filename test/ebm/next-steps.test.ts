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
import { ebmSteps, lastQuarterEnd } from "@/lib/ebm/next-steps";
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

  const sourced = (extra: ProductMetric) =>
    ebmSteps(
      {
        boards: recent,
        metrics: [...all(), extra],
        goals: [goal],
        trackers: trackers([running("ttm")]),
      },
      TODAY
    );

  it("sends a sourced measure with no reading in 30 days to the tool it reads", () => {
    const steps = sourced(
      measure("cycle", "time-to-market", 5, {
        source: "cycle-time-median",
        readings: [{ id: "r", date: "2026-09-01", value: 5 }],
      })
    );
    expect(steps).toEqual([
      {
        id: "ebm-source-reading",
        label: "Update cycle from Cycle Time",
        detail:
          "It has had no reading in 30 days. Check Cycle Time has new data, then add the reading on the EBM Dashboard.",
        href: "/cycle-time",
      },
    ]);
  });

  it("sends a source with no data yet to its tool, where the data can be added", () => {
    const steps = sourced(
      measure("nps", "current-value", 5, { source: "nps-90d", direction: "increase", readings: [] })
    );
    expect(steps.map((s) => [s.label, s.href])).toEqual([
      ["Update nps from NPS & CSAT", "/nps-csat"],
    ]);
  });

  it("counts a DORA reading on the last quarter's end as current", () => {
    const dora = (date: string) =>
      measure("lead", "time-to-market", 5, {
        source: "dora-lead-time",
        direction: "decrease",
        baseline: undefined,
        target: undefined,
        readings: [{ id: "r", date, value: 3 }],
      });
    // 54 days old on 2026-11-20, but Q3's sample is the newest the source has.
    expect(sourced(dora("2026-09-30"))).toEqual([]);
    const steps = sourced(dora("2026-06-30"));
    expect(steps.map((s) => [s.label, s.href])).toEqual([
      ["Update lead from DORA Scorecard", "/dora-scorecard"],
    ]);
    expect(steps[0].detail).toBe(
      "Its latest reading is from before 2026-09-30, the last quarter's end. Log that quarter in DORA Scorecard, then add the reading on the EBM Dashboard."
    );
  });

  it("knows the last quarter's end", () => {
    expect(lastQuarterEnd("2026-11-20")).toBe("2026-09-30");
    expect(lastQuarterEnd("2026-01-05")).toBe("2025-12-31");
    expect(lastQuarterEnd("2026-04-01")).toBe("2026-03-31");
    expect(lastQuarterEnd("2026-07-31")).toBe("2026-06-30");
    expect(lastQuarterEnd("nope")).toBeNull();
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
