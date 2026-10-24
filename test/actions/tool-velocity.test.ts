/**
 * tool.velocity.compute coverage.
 *
 *   1. registered as a read action
 *   2. empty → zeroed metrics, no forecast (no NaN)
 *   3. explicit velocities → correct average + rolling avg (last 3)
 *   4. reads completed sprints from the workspace when no array is passed
 *      (and ignores non-completed / missing-points sprints)
 *   5. a steadily rising series trends "up" and forecasts a positive next
 *   6. the page's numbers: the shared velocity (last 3 by END date, not
 *      store order), the graded say/do and points per person-day
 *   7. the MCP path reads the same rows and returns the same numbers
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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
import type { CapacityPlan, Sprint } from "@/lib/stores/workspace-types";
import { capacityPlanIdFor, CAPACITY_PLAN_ID } from "@/lib/sprints/capacity";
import { toVelocityRows, velocitySummary } from "@/app/(tools)/velocity/view";

import "@/lib/actions/tools/velocity";

function ctx(source: "agent" | "mcp" = "agent") {
  return { userId: "test-user", source, squadProfileIds: [] as string[] };
}

type Metrics = {
  count: number;
  average: number;
  rollingAverage: number;
  trend: "up" | "down" | "none";
  trendSignificant: boolean;
  predictability: number;
  forecastNext: null | { yHat: number; lower80: number; upper80: number };
  velocities: number[];
  velocity: { average: number | null; count: number; window: number; sprintIds: string[] };
  sayDo: null | {
    perSprint: { sprintId: string; pct: number; grade: string }[];
    met: number;
    close: number;
    missed: number;
    over: number;
    considered: number;
    metPct: number | null;
    meanPct: number | null;
  };
  perPersonDay: null | {
    average: number | null;
    count: number;
    perSprint: { sprintId: string; points: number; personDays: number; perDay: number }[];
  };
};

function sprint(p: Partial<Sprint> & Pick<Sprint, "id">): Sprint {
  return {
    name: p.id,
    startDate: "2026-01-01",
    endDate: "2026-01-14",
    pointsPlanned: 20,
    status: "completed",
    ...p,
  } as Sprint;
}

const plan = (sprintId: string | null, people: { availability: number; daysOff: number }[]) =>
  ({
    id: sprintId ? capacityPlanIdFor(sprintId) : CAPACITY_PLAN_ID,
    ...(sprintId ? { sprintId } : {}),
    members: people.map((m, i) => ({ id: `m${i}`, name: `P${i}`, role: "Dev", ...m })),
    config: {
      sprintDays: 10,
      ceremonyOverhead: 10,
      focusFactor: 0.8,
      hoursPerDay: 6,
      pointsCommitted: "",
    },
  }) as CapacityPlan;

describe("tool.velocity.compute", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sprints: [], capacityPlans: [] });
    rows.clear();
  });

  it("is a read action", () => {
    expect(registry.get("tool.velocity.compute")?.category).toBe("read");
  });

  it("returns zeroed metrics for no data (no NaN)", async () => {
    const action = registry.get("tool.velocity.compute");
    const r = (await action!.handler({ velocities: [] }, ctx())) as Metrics;
    expect(r.count).toBe(0);
    expect(r.average).toBe(0);
    expect(r.forecastNext).toBeNull();
    // The shared velocity says "none", never 0.
    expect(r.velocity.average).toBeNull();
    expect(r.sayDo).toBeNull();
    expect(r.perPersonDay).toBeNull();
  });

  it("computes average and rolling average (last 3) from an explicit series", async () => {
    const action = registry.get("tool.velocity.compute");
    const r = (await action!.handler({ velocities: [10, 20, 30, 40] }, ctx())) as Metrics;
    expect(r.count).toBe(4);
    expect(r.average).toBe(25); // (10+20+30+40)/4
    expect(r.rollingAverage).toBe(30); // (20+30+40)/3
    expect(r.velocity).toMatchObject({ average: 30, count: 3, window: 3 });
  });

  it("reads completed sprints from the workspace, ignoring non-completed", async () => {
    useWorkspaceStore.getState().upsertSprint(sprint({ id: "s1", pointsCompleted: 18 }));
    useWorkspaceStore.getState().upsertSprint(sprint({ id: "s2", pointsCompleted: 22 }));
    useWorkspaceStore
      .getState()
      .upsertSprint(sprint({ id: "s3", status: "active", pointsCompleted: 999 }));

    const action = registry.get("tool.velocity.compute");
    const r = (await action!.handler({}, ctx())) as Metrics;
    expect(r.count).toBe(2); // active sprint excluded
    expect(r.average).toBe(20); // (18+22)/2
  });

  it("flags a clear upward trend and forecasts a positive next sprint", async () => {
    const action = registry.get("tool.velocity.compute");
    // 10 monotonically rising points → Mann-Kendall is significant at α=0.05.
    const rising = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
    const r = (await action!.handler({ velocities: rising }, ctx())) as Metrics;
    expect(r.trend).toBe("up");
    expect(r.trendSignificant).toBe(true);
    expect(r.forecastNext).not.toBeNull();
    expect(r.forecastNext!.yHat).toBeGreaterThan(0);
  });
});

describe("tool.velocity.compute: the page's numbers", () => {
  // Stored newest first: the last 3 by end date are b, c, d, not a, d, c.
  const SPRINTS = [
    sprint({ id: "d", endDate: "2026-04-14", pointsPlanned: 30, pointsCompleted: 40 }),
    sprint({ id: "a", endDate: "2026-01-14", pointsPlanned: 30, pointsCompleted: 10 }),
    sprint({ id: "c", endDate: "2026-03-14", pointsPlanned: 30, pointsCompleted: 30 }),
    sprint({ id: "b", endDate: "2026-02-14", pointsPlanned: 30, pointsCompleted: 20 }),
    sprint({ id: "open", status: "active", endDate: "2026-05-14" }),
  ];
  // c: 10 days × (1 + 0.5) = 15 person-days; d: 10 + 8 = 18; b only has the fallback.
  const PLANS = [
    plan("c", [
      { availability: 100, daysOff: 0 },
      { availability: 50, daysOff: 0 },
    ]),
    plan("d", [
      { availability: 100, daysOff: 0 },
      { availability: 100, daysOff: 2 },
    ]),
    plan(null, [{ availability: 100, daysOff: 0 }]),
  ];

  beforeEach(() => {
    useWorkspaceStore.setState({ sprints: SPRINTS, capacityPlans: PLANS });
    rows.clear();
  });

  it("orders by end date, not the order the sprints were stored", async () => {
    const r = (await registry.get("tool.velocity.compute")!.handler({}, ctx())) as Metrics;
    expect(r.velocities).toEqual([10, 20, 30, 40]);
    expect(r.rollingAverage).toBe(30);
    expect(r.velocity).toEqual({ average: 30, count: 3, window: 3, sprintIds: ["b", "c", "d"] });
  });

  it("grades say/do and counts each grade", async () => {
    const r = (await registry.get("tool.velocity.compute")!.handler({}, ctx())) as Metrics;
    expect(r.sayDo?.perSprint.map((s) => [s.sprintId, s.pct, s.grade])).toEqual([
      ["a", 33, "missed"],
      ["b", 67, "missed"],
      ["c", 100, "met"],
      ["d", 133, "over"],
    ]);
    expect(r.sayDo).toMatchObject({ met: 1, close: 0, missed: 2, over: 1, considered: 4 });
    expect(r.sayDo?.metPct).toBe(25);
  });

  it("gives points per person-day from each sprint's own plan only", async () => {
    const r = (await registry.get("tool.velocity.compute")!.handler({}, ctx())) as Metrics;
    expect(r.perPersonDay?.perSprint).toEqual([
      { sprintId: "c", points: 30, personDays: 15, perDay: 2 },
      { sprintId: "d", points: 40, personDays: 18, perDay: 2.22 },
    ]);
    // A ratio of sums: 70 points over 33 person-days.
    expect(r.perPersonDay?.average).toBe(2.12);
    expect(r.perPersonDay?.count).toBe(2);
  });

  it("matches the Velocity page for the same sprints", async () => {
    const r = (await registry.get("tool.velocity.compute")!.handler({}, ctx())) as Metrics;
    const page = velocitySummary(SPRINTS, PLANS);
    expect(r.velocity.average).toBe(page.velocity.average);
    expect(r.velocity.sprintIds).toEqual(page.velocity.sprintIds);
    expect(r.sayDo?.met).toBe(page.sayDo.byGrade.met);
    expect(r.perPersonDay?.average).toBe(page.perPersonDay.average);
    const pageRows = toVelocityRows(SPRINTS, PLANS).filter((row) => row.finished);
    expect(pageRows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(pageRows.map((row) => row.sayDo?.grade)).toEqual(r.sayDo?.perSprint.map((s) => s.grade));
  });

  it("reads the same numbers over MCP", async () => {
    rows.set("workspace:sprint", SPRINTS);
    rows.set("workspace:capacityPlan", PLANS);
    useWorkspaceStore.setState({ sprints: [], capacityPlans: [] });
    const action = registry.get("tool.velocity.compute")!;
    const mcp = (await action.mcpHandler!({}, ctx("mcp"))) as Metrics;
    useWorkspaceStore.setState({ sprints: SPRINTS, capacityPlans: PLANS });
    const browser = (await action.handler({}, ctx())) as Metrics;
    expect(mcp).toEqual(browser);
  });
});
