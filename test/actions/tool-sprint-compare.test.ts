/**
 * tool.sprint_compare.* coverage.
 *
 *   1. compute — pure: per-dimension leaders, an overall leader, and null
 *      (never 0) for a dimension or sprint nobody scored.
 *   2. list_state — the page's six scores from the workspace, through the
 *      same lib (lib/sprints/compare), on the browser and the MCP path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path lists rows from the server store: an in-memory list per kind.
const rows = vi.hoisted(() => new Map<string, unknown[]>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) => rows.get(kind) ?? []),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { MoodEntry, Sprint, SprintGoal, SprintSeries } from "@/lib/stores/workspace-types";
import { averageScore, isFinishedSprint, sprintScores } from "@/lib/sprints/compare";
import { goalDocId } from "@/lib/sprints/goal-doc";
import { sprintsNewestFirst } from "@/lib/sprints/series";
import { EXAMPLE_SPRINT_PREFIX } from "@/lib/sprints/example";
import { defaultPins } from "@/app/(tools)/sprint-compare/pins";
import "@/lib/actions/tools/sprint-compare";

function ctx(source: "agent" | "mcp" = "agent") {
  return { userId: "u", source, squadProfileIds: [] as string[] };
}

type Result = {
  dimensions: {
    dim: string;
    min: number | null;
    max: number | null;
    average: number | null;
    leader: string | null;
  }[];
  perSprint: { name: string; total: number; average: number | null }[];
  overallLeader: string | null;
};

type Listed = {
  sprints: {
    id: string;
    name: string;
    scores: Record<
      string,
      { value: number | null; source: string; basis: string; editable: boolean }
    >;
    average: number | null;
  }[];
  notFound?: string[];
};

describe("tool.sprint_compare.compute", () => {
  it("is a read action", () => {
    expect(registry.get("tool.sprint_compare.compute")?.category).toBe("read");
    expect(registry.get("tool.sprint_compare.compute")?.mcpHandler).toBeTypeOf("function");
  });

  it("computes per-dimension leaders and an overall leader", async () => {
    const action = registry.get("tool.sprint_compare.compute");
    const r = (await action!.handler(
      {
        sprints: [
          { name: "A", dimensions: { velocity: 8, quality: 8 } },
          { name: "B", dimensions: { velocity: 5, quality: 9 } },
        ],
      },
      ctx()
    )) as Result;

    const velocity = r.dimensions.find((d) => d.dim === "velocity")!;
    expect(velocity.min).toBe(5);
    expect(velocity.max).toBe(8);
    expect(velocity.leader).toBe("A");

    const quality = r.dimensions.find((d) => d.dim === "quality")!;
    expect(quality.leader).toBe("B");

    // A avg = 8, B avg = 7 → A leads overall
    expect(r.perSprint.find((s) => s.name === "A")!.average).toBe(8);
    expect(r.overallLeader).toBe("A");
  });

  it("returns null, not 0, for what nobody scored", async () => {
    const r = (await registry.get("tool.sprint_compare.compute")!.handler(
      {
        sprints: [
          { name: "A", dimensions: {} },
          { name: "B", dimensions: { quality: 6 } },
        ],
      },
      ctx()
    )) as Result;
    expect(r.perSprint.find((s) => s.name === "A")!.average).toBeNull();
    expect(r.overallLeader).toBe("B");
    const none = (await registry
      .get("tool.sprint_compare.compute")!
      .handler({ sprints: [{ name: "A", dimensions: {} }] }, ctx())) as Result;
    expect(none.overallLeader).toBeNull();
  });
});

describe("tool.sprint_compare.list_state", () => {
  const sprint = (n: number, points: number | undefined, status: Sprint["status"] = "completed") =>
    ({
      id: `s${n}`,
      name: `Sprint ${n}`,
      startDate: `2026-0${n}-01`,
      endDate: `2026-0${n}-14`,
      pointsPlanned: 30,
      ...(points !== undefined ? { pointsCompleted: points } : {}),
      status,
    }) as Sprint;
  const SPRINTS = [sprint(1, 24), sprint(2, 30), sprint(3, 27), sprint(4, undefined, "active")];
  const SERIES: SprintSeries[] = [
    { id: "s3", ratings: { Quality: 7 }, days: [{ day: 4, scope: 33 }] },
  ];
  const GOALS: SprintGoal[] = [
    {
      id: goalDocId("s3"),
      sprintId: "s3",
      businessObjective: "",
      goal: "Ship guest checkout",
      criteria: [],
      keyResults: [],
      outcome: { met: "partly", decidedAt: "2026-03-14T16:00:00.000Z" },
    },
  ];
  const MOOD: MoodEntry[] = [3, 4, 5].map((score, i) => ({
    id: `m${i}`,
    memberId: `p${i}`,
    date: `2026-03-0${i + 2}`,
    score: score as MoodEntry["score"],
  }));

  beforeEach(() => {
    rows.clear();
    useWorkspaceStore.setState({
      sprints: SPRINTS,
      sprintSeries: SERIES,
      stories: [],
      sprintGoals: GOALS,
      moodEntries: MOOD,
      healthChecks: [],
    });
  });

  it("is a read action with an MCP handler", () => {
    const action = registry.get("tool.sprint_compare.list_state");
    expect(action?.category).toBe("read");
    expect(action?.mcpHandler).toBeTypeOf("function");
  });

  it("scores the page's default comparison: the newest finished sprints", async () => {
    const r = (await registry.get("tool.sprint_compare.list_state")!.handler({}, ctx())) as Listed;
    expect(r.sprints.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    // The same ids the page compares with nothing pinned (newest first there).
    const newest = sprintsNewestFirst(SPRINTS);
    expect(defaultPins(newest, SERIES, isFinishedSprint)).toEqual(["s3", "s2", "s1"]);
    const s3 = r.sprints[2];
    // 27 of 30 committed: met; the team's best is 30.
    expect(s3.scores.Predictability).toMatchObject({ value: 9.1, source: "computed" });
    expect(s3.scores.Velocity).toMatchObject({ value: 9.1, source: "computed" });
    expect(s3.scores["Goal Achievement"]).toMatchObject({ value: 5.5, source: "computed" });
    // +3 of 30 after day 0: 10% churn, from Burnup's log.
    expect(s3.scores["Scope Stability"]).toMatchObject({ value: 9.1, source: "computed" });
    // 4/5 from three check-ins.
    expect(s3.scores["Team Happiness"]).toMatchObject({
      value: 7.8,
      source: "prefilled",
      editable: true,
    });
    expect(s3.scores.Quality).toMatchObject({ value: 7, source: "typed", editable: true });

    const page = sprintScores({
      sprint: SPRINTS[2],
      sprints: SPRINTS,
      stories: [],
      series: SERIES,
      goals: GOALS,
      moodEntries: MOOD,
      healthChecks: [],
    });
    expect(s3.average).toBe(averageScore(page));
    for (const [dim, score] of Object.entries(page)) {
      expect(s3.scores[dim].value, dim).toBe(score.value);
      expect(s3.scores[dim].basis, dim).toBe(score.basis);
    }
  });

  it("falls back to the three newest sprints while none is finished, as the page does", async () => {
    const open = [1, 2, 3, 4].map((n) => sprint(n, undefined, n === 4 ? "active" : "planned"));
    useWorkspaceStore.setState({ sprints: open });
    const r = (await registry.get("tool.sprint_compare.list_state")!.handler({}, ctx())) as Listed;
    expect(r.sprints.map((s) => s.id)).toEqual(["s2", "s3", "s4"]);
    expect(defaultPins(sprintsNewestFirst(open), [], isFinishedSprint)).toEqual(["s4", "s3", "s2"]);
    // Example sprints never count.
    useWorkspaceStore.setState({
      sprints: [...SPRINTS, { ...sprint(5, 30), id: `${EXAMPLE_SPRINT_PREFIX}5` }],
    });
    const again = (await registry
      .get("tool.sprint_compare.list_state")!
      .handler({}, ctx())) as Listed;
    expect(again.sprints.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("scores the sprints asked for, and says which don't exist", async () => {
    const r = (await registry
      .get("tool.sprint_compare.list_state")!
      .handler({ sprintIds: ["s4", "gone"] }, ctx())) as Listed;
    expect(r.sprints.map((s) => s.id)).toEqual(["s4"]);
    expect(r.notFound).toEqual(["gone"]);
    // A running sprint: nothing to compute yet, never a 0.
    expect(r.sprints[0].scores.Predictability).toMatchObject({ value: null, source: "none" });
    expect(r.sprints[0].average).toBeNull();
  });

  it("reads the same rows over MCP", async () => {
    rows.set("workspace:sprint", SPRINTS);
    rows.set("workspace:sprintSeries", SERIES);
    rows.set("workspace:sprintGoal", GOALS);
    rows.set("workspace:moodEntry", MOOD);
    const action = registry.get("tool.sprint_compare.list_state")!;
    const browser = await action.handler({}, ctx());
    useWorkspaceStore.setState({ sprints: [], sprintSeries: [], sprintGoals: [], moodEntries: [] });
    const mcp = await action.mcpHandler!({}, ctx("mcp"));
    expect(mcp).toEqual(browser);
  });
});
