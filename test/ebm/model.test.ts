// @vitest-environment node
/**
 * lib/ebm/model: area progress over the measures that have one (null,
 * never 0, when none does), the weakest and the focus area, the goal
 * ladder (no completed sprint), Suggest a focus, the 24-review cap, and
 * the forms.
 */

import { describe, expect, it } from "vitest";
import {
  EBM_BOARD_ID,
  type EbmBoard,
  type EbmReview,
  type ProductGoal,
  type ProductMetric,
  type Sprint,
} from "@/lib/stores/workspace-types";
import {
  AREA_NEXT_STEPS,
  REVIEWS_MAX,
  REVIEW_TOO_OLD,
  holdsReview,
  areaProgress,
  areaScores,
  ebmExampleLoaded,
  ebmVerdict,
  emptyEbmBoard,
  focusArea,
  goalLadder,
  measuresByArea,
  newReview,
  readBoard,
  ruleReview,
  sourceProblem,
  sourcesFor,
  validateReview,
  validateStrategicGoal,
  weakestArea,
  withReview,
  withStrategicGoal,
} from "@/lib/ebm/model";
import { buildEbmExample } from "@/app/(tools)/ebm-dashboard/example";

const NOW = "2026-11-20T10:00:00.000Z";
const TODAY = "2026-11-20";

const measure = (over: Partial<ProductMetric>): ProductMetric => ({
  id: "metric_a",
  name: "Measure",
  direction: "increase",
  kva: "current-value",
  readings: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const reading = (value: number, date = TODAY) => ({ id: `r-${date}-${value}`, date, value });

describe("area progress", () => {
  it("is the mean of the measures' progress, skipping those without one", () => {
    const ms = [
      measure({ id: "a", baseline: 0, target: 10, readings: [reading(5)] }),
      measure({ id: "b", baseline: 0, target: 10, readings: [reading(10)] }),
      measure({ id: "c", readings: [reading(3)] }),
    ];
    expect(areaProgress(ms)).toBe(0.75);
    expect(areaProgress([measure({ readings: [reading(3)] })])).toBeNull();
    expect(areaProgress([])).toBeNull();
  });

  it("scores only measured areas, finds the weakest, and focuses an unmeasured one first", () => {
    const ms = [
      measure({ id: "a", kva: "current-value", baseline: 0, target: 10, readings: [reading(8)] }),
      measure({ id: "b", kva: "time-to-market", baseline: 0, target: 10, readings: [reading(2)] }),
    ];
    const scores = areaScores(measuresByArea(ms));
    expect(scores).toEqual({ "current-value": 0.8, "time-to-market": 0.2 });
    expect(weakestArea(scores)).toBe("time-to-market");
    expect(focusArea(scores)).toBe("unrealized-value");
    expect(focusArea({ ...scores, "unrealized-value": 0.5, "ability-to-innovate": 0.9 })).toBe(
      "time-to-market"
    );
    expect(weakestArea({})).toBeNull();
  });
});

describe("ruleReview", () => {
  it("names an area with no measure, with our next steps", () => {
    const r = ruleReview(
      measuresByArea([measure({ baseline: 0, target: 4, readings: [reading(1)] })])
    );
    expect(r.focus).toBe("unrealized-value");
    expect(r.summary).toMatch(/Current Value 25%, Unrealized Value not measured/);
    expect(r.summary).toMatch(/Unrealized Value has no measure yet/);
    expect(r.steps).toEqual([...AREA_NEXT_STEPS["unrealized-value"]]);
  });

  it("names the weakest when every area is measured", () => {
    const { metrics } = buildEbmExample(TODAY, NOW);
    const r = ruleReview(measuresByArea(metrics));
    expect(Object.keys(r.areas)).toHaveLength(4);
    expect(r.focus).toBe(weakestArea(r.areas));
    expect(r.summary).toMatch(/is furthest from its targets/);
  });
});

describe("the goal ladder", () => {
  const goal: ProductGoal = {
    id: "goal_a",
    statement: "Teams improve every sprint",
    measures: [],
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const sprint = (over: Partial<Sprint>): Sprint =>
    ({
      id: "sprint_1",
      name: "Sprint 1",
      startDate: "2026-11-16",
      endDate: "2026-11-29",
      status: "active",
      goal: "Ship the follow-up reminders",
      ...over,
    }) as Sprint;

  it("reads the strategic goal, the active Product Goal and the sprint's goal", () => {
    const board = {
      ...emptyEbmBoard(NOW),
      strategicGoal: "More teams improve",
      strategicWhy: "Because",
    };
    expect(goalLadder({ board, goals: [goal], sprints: [sprint({})] })).toEqual({
      strategic: { goal: "More teams improve", why: "Because" },
      intermediate: { id: "goal_a", statement: goal.statement },
      tactical: {
        sprintId: "sprint_1",
        sprintName: "Sprint 1",
        goal: "Ship the follow-up reminders",
      },
    });
  });

  it("reads no tactical goal from a completed or example sprint, nor an example goal", () => {
    const l = goalLadder({
      board: null,
      goals: [{ ...goal, id: "example-goal" }],
      sprints: [sprint({ status: "completed" }), sprint({ id: "example-s", status: "active" })],
    });
    expect(l).toEqual({ strategic: null, intermediate: null, tactical: null });
  });
});

describe("the board", () => {
  const review = (i: number): EbmReview => ({
    id: `review_${i}`,
    date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    focus: "time-to-market",
    areas: {},
  });

  it("keeps the newest 24 reviews, oldest first", () => {
    let b: EbmBoard | null = null;
    for (let i = 0; i < REVIEWS_MAX + 2; i++) b = withReview(b, review(i), NOW);
    expect(b?.reviews).toHaveLength(REVIEWS_MAX);
    expect(b?.reviews[0].id).toBe("review_2");
    expect(b?.id).toBe(EBM_BOARD_ID);
  });

  it("knows when a backdated review was dropped at once", () => {
    let b: EbmBoard | null = null;
    for (let i = 0; i < REVIEWS_MAX; i++) b = withReview(b, review(i), NOW);
    const old = { ...review(0), id: "review_old", date: "2024-06-01" };
    const next = withReview(b, old, NOW);
    expect(holdsReview(next, "review_old")).toBe(false);
    expect(holdsReview(withReview(b, { ...old, date: "2026-11-01" }, NOW), "review_old")).toBe(
      true
    );
    expect(REVIEW_TOO_OLD).toMatch(/^Only the newest 24 reviews are kept/);
  });

  it("reads a stored board defensively", () => {
    const raw = {
      ...emptyEbmBoard(NOW),
      reviews: [
        { id: "b", date: "2026-10-01", focus: "current-value", areas: { "current-value": 2 } },
        { id: "a", date: "2026-09-01", focus: "nope", areas: {} },
        null,
      ],
    } as unknown as EbmBoard;
    const b = readBoard([raw]);
    expect(b?.reviews).toEqual([
      { id: "b", date: "2026-10-01", focus: "current-value", areas: { "current-value": 1 } },
    ]);
    expect(readBoard(undefined)).toBeNull();
  });

  it("sets and clears the strategic goal", () => {
    const set = withStrategicGoal(null, { goal: "Grow", why: "Why" }, NOW);
    expect(set).toMatchObject({ strategicGoal: "Grow", strategicWhy: "Why" });
    const cleared = withStrategicGoal(set, {}, NOW);
    expect("strategicGoal" in cleared || "strategicWhy" in cleared).toBe(false);
  });

  it("snapshots the areas' scores in a new review", () => {
    const byArea = measuresByArea([measure({ baseline: 0, target: 2, readings: [reading(1)] })]);
    expect(newReview("review_x", { date: TODAY, focus: "current-value" }, byArea)).toEqual({
      id: "review_x",
      date: TODAY,
      focus: "current-value",
      areas: { "current-value": 0.5 },
    });
  });

  it("knows when the example is loaded, and says a verdict", () => {
    const ex = buildEbmExample(TODAY, NOW);
    expect(ebmExampleLoaded(ex.metrics, null)).toBe(true);
    expect(ebmExampleLoaded([], { ...emptyEbmBoard(NOW), reviews: ex.reviews })).toBe(true);
    expect(ebmExampleLoaded([measure({})], null)).toBe(false);
    expect(ebmVerdict(measuresByArea([]), null, TODAY)).toMatch(/No measures yet/);
    expect(
      ebmVerdict(measuresByArea(ex.metrics), withReview(null, ex.reviews[1], NOW), TODAY)
    ).toMatch(/4 of 4 areas measured; .* is the weakest at \d+%\. Last review 35 days ago\./);
  });
});

describe("the forms", () => {
  it("needs a day not after today and an area", () => {
    expect(validateReview({ date: "2026-11-21", focus: "", note: "" }, TODAY)).toMatchObject({
      ok: false,
    });
    expect(validateReview({ date: TODAY, focus: "current-value", note: " n " }, TODAY)).toEqual({
      ok: true,
      values: { date: TODAY, focus: "current-value", note: "n" },
    });
  });

  it("caps the strategic goal and needs a goal for a why", () => {
    expect(validateStrategicGoal({ goal: "x".repeat(1001), why: "" }).ok).toBe(false);
    expect(validateStrategicGoal({ goal: "", why: "Because" }).ok).toBe(false);
    expect(validateStrategicGoal({ goal: "", why: "" })).toEqual({ ok: true, values: {} });
  });
});

describe("toolkit sources", () => {
  it("offers an area only its own sources, and Unrealized Value none", () => {
    expect(sourcesFor("time-to-market")).toEqual([
      "cycle-time-median",
      "dora-lead-time",
      "dora-deploys",
    ]);
    expect(sourcesFor("current-value")).toEqual(["nps-90d"]);
    expect(sourcesFor("ability-to-innovate")).toEqual(["dora-change-fail", "open-tech-debt"]);
    expect(sourcesFor("unrealized-value")).toEqual([]);
  });

  it("refuses a source from another area, or a direction against the source's", () => {
    expect(sourceProblem("time-to-market", "cycle-time-median", "decrease")).toBeNull();
    expect(sourceProblem("time-to-market", "cycle-time-median", "increase")).toBe(
      "“Median cycle time, last 90 days” is a “Lower is better” number, so the measure must be too."
    );
    expect(sourceProblem("unrealized-value", "nps-90d", "increase")).toBe(
      "“NPS, last 90 days” is a Current Value number, not Unrealized Value."
    );
  });

  it("is why: a cycle time read the wrong way would score 100% while it falls", () => {
    const wrong = measure({
      kva: "time-to-market",
      source: "cycle-time-median",
      target: 3,
      readings: [reading(6.5, "2026-10-01"), reading(4.9, "2026-11-01")],
    });
    expect(areaProgress([wrong])).toBe(1);
    expect(areaProgress([{ ...wrong, direction: "decrease" }])).toBeCloseTo(1.6 / 3.5);
  });
});
