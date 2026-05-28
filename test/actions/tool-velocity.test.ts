/**
 * tool.velocity.compute coverage.
 *
 *   1. registered as a read action
 *   2. empty → zeroed metrics, no forecast (no NaN)
 *   3. explicit velocities → correct average + rolling avg (last 3)
 *   4. reads completed sprints from the workspace when no array is passed
 *      (and ignores non-completed / missing-points sprints)
 *   5. a steadily rising series trends "up" and forecasts a positive next
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/velocity";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Metrics = {
  count: number;
  average: number;
  rollingAverage: number;
  trend: "up" | "down" | "none";
  trendSignificant: boolean;
  predictability: number;
  forecastNext: null | { yHat: number; lower80: number; upper80: number };
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

describe("tool.velocity.compute", () => {
  beforeEach(() => useWorkspaceStore.setState({ sprints: [] }));

  it("is a read action", () => {
    expect(registry.get("tool.velocity.compute")?.category).toBe("read");
  });

  it("returns zeroed metrics for no data (no NaN)", async () => {
    const action = registry.get("tool.velocity.compute");
    const r = (await action!.handler({ velocities: [] }, ctx())) as Metrics;
    expect(r.count).toBe(0);
    expect(r.average).toBe(0);
    expect(r.forecastNext).toBeNull();
  });

  it("computes average and rolling average (last 3) from an explicit series", async () => {
    const action = registry.get("tool.velocity.compute");
    const r = (await action!.handler({ velocities: [10, 20, 30, 40] }, ctx())) as Metrics;
    expect(r.count).toBe(4);
    expect(r.average).toBe(25); // (10+20+30+40)/4
    expect(r.rollingAverage).toBe(30); // (20+30+40)/3
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
