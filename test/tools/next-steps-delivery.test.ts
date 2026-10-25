import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNextStepRule } from "@/lib/tools/next-steps";
import type {
  FeatureFlag,
  KanbanCard,
  Release,
  Sprint,
  Story,
  ValueStreamStage,
  Workspace,
} from "@/lib/stores/workspace-types";
import { KANBAN_BOARD_ID } from "@/lib/stores/workspace-types";

/**
 * Next steps for the Track delivery tools (Phase 5): each reads the
 * workspace and points somewhere real, ignores example rows, and stays
 * quiet when nothing applies.
 */

const steps = (toolId: string, ws: Partial<Workspace>) => {
  const rule = getNextStepRule(toolId);
  if (!rule) throw new Error(`no rule for ${toolId}`);
  return rule.steps(rule.select(ws as Workspace));
};
const ids = (toolId: string, ws: Partial<Workspace>) => steps(toolId, ws).map((s) => s.id);

// Monday 26 Oct 2026, mid-sprint.
const TODAY = "2026-10-26";

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  pointsPlanned: 20,
  status: "active",
  ...over,
});
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: id,
  status: "todo",
  points: 5,
  sprintId: "s2",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
});
afterEach(() => vi.useRealTimers());

describe("burndown and burnup", () => {
  it("ask for estimates when open stories have no points", () => {
    const ws = { sprints: [sprint()], stories: [story("a"), story("b", { points: undefined })] };
    expect(ids("burndown", ws)).toContain("burndown-unsized");
    expect(ids("burnup", ws)).toContain("burnup-unsized");
  });

  it("burndown: closes an ended sprint before anything else", () => {
    vi.setSystemTime(new Date("2026-11-03T09:00:00"));
    expect(ids("burndown", { sprints: [sprint()], stories: [story("a")] })[0]).toBe(
      "burndown-close"
    );
  });

  it("burnup: points at the goal when scope joined after day 0", () => {
    const joined = story("late", {
      sprintHistory: [{ sprintId: "s2", at: "2026-10-21T10:00:00.000Z", points: 5 }],
    });
    // Work began on day 1 (before that, joins are planning, not added scope).
    const started = story("a", {
      status: "in_progress",
      startedAt: "2026-10-20T10:00:00.000Z",
      statusHistory: [{ status: "in_progress", from: "todo", at: "2026-10-20T10:00:00.000Z" }],
    });
    const out = steps("burnup", { sprints: [sprint()], stories: [started, joined] });
    expect(out[0]).toMatchObject({ id: "burnup-scope-added", href: "/sprint-goal?sprint=s2" });
  });

  it("stay quiet without an open sprint, and ignore example sprints", () => {
    expect(ids("burndown", { sprints: [], stories: [] })).toEqual([]);
    expect(ids("burnup", { sprints: [sprint({ id: "example-s" })], stories: [] })).toEqual([]);
  });
});

describe("velocity and sprint metrics", () => {
  const done = (id: string, end: string, planned: number, completed?: number): Sprint =>
    sprint({
      id,
      name: id,
      startDate: "2026-09-01",
      endDate: end,
      pointsPlanned: planned,
      status: "completed",
      pointsCompleted: completed,
    });

  it("velocity: closes an ended sprint, then asks for missing points", () => {
    const out = ids("velocity", {
      sprints: [sprint({ endDate: "2026-10-23" }), done("s0", "2026-10-09", 20)],
    });
    expect(out).toEqual(["velocity-close", "velocity-missing-points"]);
  });

  it("velocity: takes two short sprints of the last three to the retro", () => {
    const out = ids("velocity", {
      sprints: [
        done("a", "2026-09-11", 20, 20),
        done("b", "2026-09-25", 20, 12),
        done("c", "2026-10-09", 20, 10),
      ],
    });
    expect(out).toEqual(["velocity-commitments"]);
  });

  it("sprint-metrics: counts finished sprints without points", () => {
    expect(
      steps("sprint-metrics", { sprints: [done("a", "2026-10-09", 20)], stories: [] })[0]
    ).toMatchObject({ id: "sprint-metrics-missing-points", href: "/velocity" });
  });
});

describe("cycle time and cumulative flow", () => {
  const card = (id: string, over: Partial<KanbanCard> = {}): KanbanCard => ({
    id,
    title: id,
    column: "done",
    class: "standard",
    createdAt: "2026-10-01T09:00:00.000Z",
    startedAt: "2026-10-05T09:00:00.000Z",
    completedAt: "2026-10-07T09:00:00.000Z",
    ...over,
  });
  const boards = (cards: KanbanCard[]) => [
    {
      id: KANBAN_BOARD_ID,
      cards,
      wipLimits: { backlog: 0, ready: 0, in_progress: 0, review: 0, done: 0 },
    },
  ];

  it("cycle-time: asks for finished work below five items", () => {
    expect(ids("cycle-time", { stories: [], kanbanBoards: boards([card("c1")]) })).toEqual([
      "cycle-time-move-work",
    ]);
  });

  it("cycle-time: flags work older than the P85 of finished work", () => {
    const finished = ["c1", "c2", "c3", "c4", "c5"].map((id) => card(id));
    const old = card("old", {
      column: "in_progress",
      startedAt: "2026-10-12T09:00:00.000Z",
      completedAt: undefined,
    });
    expect(ids("cycle-time", { stories: [], kanbanBoards: boards([...finished, old]) })).toEqual([
      "cycle-time-ageing",
    ]);
    expect(ids("cumulative-flow", { stories: [], kanbanBoards: boards(finished) })).toEqual([
      "cfd-cycle-time",
    ]);
  });
});

describe("value stream", () => {
  const stage = (
    id: string,
    processTime: number,
    leadTime: number,
    over: Partial<ValueStreamStage> = {}
  ): ValueStreamStage => ({
    id,
    name: id,
    processTime,
    leadTime,
    completeAccurate: 90,
    ...over,
  });

  it("takes the longest wait to the retro, then asks for a future state", () => {
    const out = steps("value-stream", {
      valueStreamStages: [stage("Build", 1, 2), stage("Code review", 0.5, 6.5)],
    });
    expect(out.map((s) => s.id)).toEqual(["value-stream-bottleneck", "value-stream-future"]);
    expect(out[0].label).toBe("Take the Code review wait to the retro");
  });
});

describe("release readiness and feature flags", () => {
  const release = (over: Partial<Release> = {}): Release => ({
    id: "r1",
    name: "v3.3",
    plannedDate: "2026-10-28",
    status: "planning",
    gates: {},
    ...over,
  });
  const readiness = (releases: Release[]) => [{ id: "releaseReadiness:current", releases }];

  it("takes a recent rollback to the retro and premortems a release due within a week", () => {
    const out = ids("release-readiness", {
      releaseReadinesses: readiness([
        release({
          id: "r0",
          name: "v3.2",
          status: "rolled_back",
          shippedDate: "2026-10-20",
          rolledBackAt: "2026-10-21",
        }),
        release(),
      ]),
      featureFlags: [],
    });
    expect(out).toEqual(["release-rollback-retro", "release-premortem"]);
  });

  it("flags: plans the removal of stale flags", () => {
    const flag: FeatureFlag = {
      id: "f1",
      name: "checkout_v2",
      status: "on",
      purpose: "rollout",
      createdAt: "2026-06-01",
      owner: "Sam",
    };
    expect(ids("feature-flag-tracker", { featureFlags: [flag] })).toEqual(["flags-stale"]);
    expect(ids("feature-flag-tracker", { featureFlags: [{ ...flag, id: "example-f" }] })).toEqual(
      []
    );
  });
});
