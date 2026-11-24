/**
 * Impact Map's and Strategy Tree's next steps (lib/strategy-map/next-steps),
 * through the rules lib/tools/next-steps.ts registers: the focus impact's
 * deliverable not yet on the backlog or the roadmap, a goal with no
 * measure, no focus among several impacts; a bet not tested, a test that
 * came back in the last 30 days, Hoshin questions. Example maps never
 * count. Strategy Tree's steps take the time from the caller.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getNextStepRule, loadNextStepRule } from "@/lib/tools/next-steps";
import {
  emptyWorkspace,
  type Hypothesis,
  type StrategyMap,
  type StrategyMapNode,
  type Workspace,
} from "@/lib/stores/workspace-types";
import { impactMapSteps, strategyTreeSteps } from "@/lib/strategy-map/next-steps";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";

const AT = "2026-11-20T10:00:00.000Z";
const NOW = new Date("2026-11-23T12:00:00.000Z");

const node = (
  id: string,
  parentId: string | null,
  level: 0 | 1 | 2 | 3,
  extra: Partial<StrategyMapNode> = {}
): StrategyMapNode => ({ id, parentId, level, text: id, ...extra });

const map = (
  id: string,
  nodes: StrategyMapNode[],
  over: Partial<StrategyMap> = {}
): StrategyMap => ({
  id,
  format: "impact-map",
  title: id,
  nodes,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const FOCUSED = map("m1", [
  node("Grow orders", null, 0, { measure: "Repeat rate" }),
  node("Parents", "Grow orders", 1),
  node("Skip a week", "Parents", 2, { focus: true }),
  node("Pause button", "Skip a week", 3),
  node("Reorder", "Parents", 2),
]);

const steps = (toolId: string, ws: Partial<Workspace>) => {
  const rule = getNextStepRule(toolId)!;
  return rule.steps(rule.select({ ...emptyWorkspace, ...ws } as Workspace));
};

describe("the registered rules", () => {
  beforeAll(async () => {
    await loadNextStepRule("impact-map");
    await loadNextStepRule("strategy-tree");
  });

  it("Impact Map's rule reads the maps, the stories and the roadmap", () => {
    expect(steps("impact-map", {}).length).toBe(0);
    expect(steps("impact-map", { strategyMaps: [FOCUSED] }).map((s) => s.id)).toEqual([
      "impact-map-deliverable",
    ]);
  });

  it("Strategy Tree's rule reads the trees and the tracker", () => {
    const dibb = map(
      "t1",
      [node("d", null, 0), node("i", "d", 1), node("b", "i", 2), node("bet", "b", 3)],
      {
        format: "dibb",
      }
    );
    expect(steps("strategy-tree", { strategyMaps: [dibb] }).map((s) => s.id)).toEqual([
      "strategy-tree-test",
    ]);
  });
});

describe("impactMapSteps", () => {
  it("asks to put the focus impact's deliverable on the backlog, linking to its map", () => {
    const [step] = impactMapSteps({ maps: [FOCUSED], stories: [], roadmaps: [] });
    expect(step).toEqual({
      id: "impact-map-deliverable",
      label: "Put “Pause button” on the backlog",
      detail: "It serves the impact you work on first, “Skip a week”.",
      href: "/impact-map?map=m1",
    });
  });

  it("counts a deliverable on the backlog or the roadmap as placed, a deleted one not", () => {
    const sent = (route: "backlog-story" | "epic", targetId: string) =>
      map(
        "m1",
        FOCUSED.nodes.map((n) =>
          n.id === "Pause button" ? { ...n, sentTo: [{ route, targetId, at: AT }] } : n
        )
      );
    const story = { id: "s1", title: "Pause", status: "backlog" as const };
    expect(
      impactMapSteps({ maps: [sent("backlog-story", "s1")], stories: [story], roadmaps: [] })
    ).toEqual([]);
    const roadmap = {
      id: "epicRoadmap:current",
      epics: [
        { id: "e1", title: "E", startQuarter: "2027-Q1", endQuarter: "2027-Q1", progress: 0 },
      ],
    };
    expect(
      impactMapSteps({ maps: [sent("epic", "e1")], stories: [], roadmaps: [roadmap] })
    ).toEqual([]);
    expect(
      impactMapSteps({ maps: [sent("backlog-story", "gone")], stories: [], roadmaps: [] })
    ).toHaveLength(1);
  });

  it("asks for a goal's measure, and for a focus among several impacts", () => {
    const m = map("m2", [
      node("Grow orders", null, 0),
      node("Parents", "Grow orders", 1),
      node("Skip", "Parents", 2),
      node("Reorder", "Parents", 2),
    ]);
    expect(impactMapSteps({ maps: [m], stories: [], roadmaps: [] })).toEqual([
      expect.objectContaining({
        id: "impact-map-measure",
        label: "Give “Grow orders” a measure",
        href: "/impact-map?map=m2",
      }),
      expect.objectContaining({
        id: "impact-map-focus",
        label: "Pick the impact to work on first",
      }),
    ]);
  });

  it("leaves example maps out", () => {
    expect(
      impactMapSteps({
        maps: [{ ...FOCUSED, id: "example-impact-map" }],
        stories: [],
        roadmaps: [],
      })
    ).toEqual([]);
    expect(impactMapSteps({ maps: undefined, stories: [], roadmaps: undefined })).toEqual([]);
  });
});

describe("strategyTreeSteps", () => {
  const hypothesis = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
    id,
    believe: "b",
    willDo: "w",
    toLearn: "l",
    successMetric: "m",
    status: "drafted",
    raisedAt: "2026-11-01",
    ...over,
  });
  const lvt = (betLinks: StrategyMapNode["sentTo"]) =>
    map(
      "t2",
      [
        node("Vision", null, 0),
        node("Goal", "Vision", 1, { measure: "m" }),
        node("Bet", "Goal", 2, { measure: "m", ...(betLinks ? { sentTo: betLinks } : {}) }),
      ],
      { format: "lean-value-tree" }
    );
  const tracker = (hypotheses: Hypothesis[]) => [{ id: HYPOTHESIS_TRACKER_ID, hypotheses }];
  const link = [{ route: "hypothesis" as const, targetId: "h1", at: AT }];

  it("asks to test an untested bet", () => {
    expect(strategyTreeSteps({ maps: [lvt(undefined)], trackers: [] }, NOW)).toEqual([
      {
        id: "strategy-tree-test",
        label: "Test the bet “Bet”",
        detail: "A bet with a test tells you whether to keep going.",
        href: "/strategy-tree?tree=t2",
      },
    ]);
  });

  it("points at a result from the last 30 days, not an older one", () => {
    const fresh = tracker([hypothesis("h1", { status: "validated", resolvedAt: "2026-11-10" })]);
    expect(strategyTreeSteps({ maps: [lvt(link)], trackers: fresh }, NOW)).toEqual([
      expect.objectContaining({
        id: "strategy-tree-result",
        label: "See what the test of “Bet” found",
        href: "/hypothesis-tracker",
      }),
    ]);
    const old = tracker([hypothesis("h1", { status: "validated", resolvedAt: "2026-09-01" })]);
    expect(strategyTreeSteps({ maps: [lvt(link)], trackers: old }, NOW)).toEqual([]);
    const running = tracker([hypothesis("h1", { status: "running" })]);
    expect(strategyTreeSteps({ maps: [lvt(link)], trackers: running }, NOW)).toEqual([]);
  });

  it("counts Hoshin questions for the catchball", () => {
    const hoshin = map(
      "t3",
      [
        node("Aim", null, 0, { status: "agreed" }),
        node("Annual", "Aim", 1, { status: "questioned" }),
        node("Priority", "Annual", 2, { status: "questioned" }),
      ],
      { format: "hoshin" }
    );
    expect(strategyTreeSteps({ maps: [hoshin], trackers: [] }, NOW)).toEqual([
      expect.objectContaining({
        id: "strategy-tree-catchball",
        label: "Answer 2 questions in the catchball",
        href: "/strategy-tree?tree=t3",
      }),
    ]);
  });

  it("leaves impact maps, dropped bets and examples out", () => {
    const dropped = map(
      "t4",
      [
        node("Vision", null, 0),
        node("Goal", "Vision", 1),
        node("Bet", "Goal", 2, { status: "dropped" }),
      ],
      { format: "lean-value-tree" }
    );
    expect(strategyTreeSteps({ maps: [FOCUSED, dropped], trackers: [] }, NOW)).toEqual([]);
    expect(
      strategyTreeSteps(
        { maps: [{ ...lvt(undefined), id: "example-strategy-tree-x" }], trackers: [] },
        NOW
      )
    ).toEqual([]);
  });
});
