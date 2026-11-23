// @vitest-environment node
/**
 * The A/B Calculator's next steps, called directly: read a running test
 * once it has run its planned days or reached its planned sample; use a
 * decided test's result on a hypothesis still open; plan a test for a
 * running hypothesis with a "%" target and a split experiment. Example rows
 * never count. The rule in lib/tools/next-steps.ts loads this module.
 */

import { describe, expect, it } from "vitest";
import { abCalculatorSteps } from "@/lib/experiments/next-steps";
import { getNextStepRule, loadNextStepRule } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type AbTest,
  type Hypothesis,
  type Workspace,
} from "@/lib/stores/workspace-types";

const TODAY = "2026-11-20";
const AT = "2026-11-01T09:00:00.000Z";

const test = (id: string, over: Partial<AbTest> = {}): AbTest => ({
  id,
  name: `Test ${id}`,
  plan: {
    baseline: 0.1,
    mde: 0.2,
    mdeMode: "relative",
    confidence: 0.95,
    power: 0.8,
    sided: "two",
    dailyTraffic: 800,
  },
  variants: [
    { id: "a", name: "A", visitors: 0, conversions: 0 },
    { id: "b", name: "B", visitors: 0, conversions: 0 },
  ],
  status: "running",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const hypothesis = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `Belief ${id}`,
  willDo: "Run it",
  toLearn: "Whether it works",
  successMetric: "Sign-ups",
  status: "running",
  raisedAt: "2026-10-01",
  ...over,
});
const trackers = (hypotheses: Hypothesis[]) => [{ id: "hypothesisTracker:current", hypotheses }];

const counts = (a: number, b: number): AbTest["variants"] => [
  { id: "a", name: "A", visitors: a, conversions: Math.round(a / 10) },
  { id: "b", name: "B", visitors: b, conversions: Math.round(b / 8) },
];

describe("read a running test", () => {
  it("once its smaller version has the planned sample", () => {
    expect(
      abCalculatorSteps(
        { tests: [test("t1", { variants: counts(3900, 3841) })], trackers: [] },
        TODAY
      )
    ).toEqual([
      {
        id: "ab-calculator-read",
        label: "Read the result of “Test t1”",
        detail: "Each version has at least 3,841 visitors, the sample the plan needs.",
        href: "/ab-calculator",
      },
    ]);
  });

  it("once it has run its planned days, even without counts", () => {
    // 3,841 a version at 800 a day is 10 days.
    const [s] = abCalculatorSteps(
      { tests: [test("t1", { startedOn: "2026-11-10" })], trackers: [] },
      TODAY
    );
    expect(s.id).toBe("ab-calculator-read");
    expect(s.detail).toBe(
      "It started on 2026-11-10 and has run the 10 days the plan needs. Type the visitors and conversions to read it."
    );
    expect(
      abCalculatorSteps({ tests: [test("t1", { startedOn: "2026-11-11" })], trackers: [] }, TODAY)
    ).toEqual([]);
  });

  it("not while it is short, planned or done, nor for the example", () => {
    const tests = [
      test("short", { variants: counts(3000, 3900) }),
      test("planned", { status: "planned", variants: counts(5000, 5000) }),
      test("done", { status: "done", variants: counts(5000, 5000) }),
      test("example-1", { variants: counts(5000, 5000) }),
    ];
    expect(abCalculatorSteps({ tests, trackers: [] }, TODAY)).toEqual([]);
  });

  it("counts the others that are ready too", () => {
    const tests = [
      test("t1", { variants: counts(4000, 4000) }),
      test("t2", { variants: counts(4000, 4000) }),
    ];
    const [s] = abCalculatorSteps({ tests, trackers: [] }, TODAY);
    expect(s.detail).toMatch(/1 other running test is ready too\.$/);
  });
});

describe("use a decided result", () => {
  it("when its hypothesis is still open", () => {
    const steps = abCalculatorSteps(
      {
        tests: [test("t1", { status: "done", decision: "ship", hypothesisId: "h1" })],
        trackers: trackers([hypothesis("h1")]),
      },
      TODAY
    );
    expect(steps).toEqual([
      {
        id: "ab-calculator-use-result",
        label: "Use the A/B result on its hypothesis",
        detail:
          "“Test t1” is decided, and its hypothesis “Belief h1” is still running. “Use the A/B result” on its card records it there.",
        href: "/hypothesis-tracker",
      },
    ]);
  });

  it("not once the hypothesis has a result, or without a decision", () => {
    expect(
      abCalculatorSteps(
        {
          tests: [
            test("t1", { status: "done", decision: "ship", hypothesisId: "h1" }),
            test("t2", { status: "done", hypothesisId: "h2" }),
          ],
          trackers: trackers([
            hypothesis("h1", { status: "validated", resolvedAt: "2026-11-19" }),
            hypothesis("h2"),
          ]),
        },
        TODAY
      ).map((s) => s.id)
    ).toEqual([]);
  });
});

describe("plan a test for a hypothesis", () => {
  const split = (over: Partial<Hypothesis> = {}) =>
    hypothesis("h1", {
      experiment: "An A/B split on the pricing page",
      target: { direction: "increase", value: 12, unit: "%", baseline: 10 },
      ...over,
    });

  it("when a running one with a % target is tested by a split and has no test", () => {
    expect(abCalculatorSteps({ tests: [], trackers: trackers([split()]) }, TODAY)).toEqual([
      {
        id: "ab-calculator-plan",
        label: "Plan the A/B test",
        detail:
          "“Belief h1” is tested with a split, but no A/B plan says how many people it needs or for how long.",
        href: "/ab-calculator?hypothesis=h1",
      },
    ]);
    expect(
      abCalculatorSteps(
        { tests: [], trackers: trackers([split({ experiment: "a split test" })]) },
        TODAY
      )
    ).toHaveLength(1);
  });

  it("not with a test already, another unit, no split, or not running", () => {
    const none = (h: Hypothesis, tests: AbTest[] = []) =>
      abCalculatorSteps({ tests, trackers: trackers([h]) }, TODAY);
    expect(none(split(), [test("t1", { status: "planned", hypothesisId: "h1" })])).toEqual([]);
    expect(none(split({ target: { direction: "increase", value: 12, unit: "days" } }))).toEqual([]);
    expect(none(split({ experiment: "interviews with ten admins" }))).toEqual([]);
    expect(none(split({ experiment: "splitting the form in two" }))).toEqual([]);
    expect(none(split({ status: "drafted" }))).toEqual([]);
    expect(none(split({ id: "example-h1" }))).toEqual([]);
  });
});

describe("the rule", () => {
  it("loads this module and reads the workspace's tests and tracker", async () => {
    await loadNextStepRule("ab-calculator");
    const rule = getNextStepRule("ab-calculator")!;
    const ws = {
      ...emptyWorkspace,
      abTests: [test("t1", { variants: counts(4000, 4000) })],
    } as Workspace;
    expect(rule.steps(rule.select(ws)).map((s) => s.id)).toEqual(["ab-calculator-read"]);
  });
});
