/**
 * tool.velocity.compute — commitmentReliability mirrors the in-app
 * "Predictability" KPI (% of sprints that met/beat commitment), distinct
 * from the CV-based `predictability` consistency score. Null when an
 * explicit velocities array (no commitment data) is supplied.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint } from "@/lib/stores/workspace-types";
import "@/lib/actions/tools/velocity";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}
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
type Metrics = { commitmentReliability: number | null; predictability: number; count: number };

describe("tool.velocity.compute — commitmentReliability", () => {
  beforeEach(() => useWorkspaceStore.setState({ sprints: [] }));

  it("is the % of completed sprints that met or beat commitment", async () => {
    const action = registry.get("tool.velocity.compute");
    // missed (18<20), met (22>=20), met (20>=20) → 2/3 = 67%
    useWorkspaceStore.getState().upsertSprint(sprint({ id: "s1", pointsCompleted: 18 }));
    useWorkspaceStore.getState().upsertSprint(sprint({ id: "s2", pointsCompleted: 22 }));
    useWorkspaceStore.getState().upsertSprint(sprint({ id: "s3", pointsCompleted: 20 }));
    const r = (await action!.handler({}, ctx())) as Metrics;
    expect(r.count).toBe(3);
    expect(r.commitmentReliability).toBe(67);
  });

  it("skips empty rows (no commitment AND no delivery)", async () => {
    const action = registry.get("tool.velocity.compute");
    useWorkspaceStore.getState().upsertSprint(sprint({ id: "s1", pointsCompleted: 22 })); // met
    useWorkspaceStore
      .getState()
      .upsertSprint(sprint({ id: "s2", pointsPlanned: 0, pointsCompleted: 0 })); // empty → skipped
    const r = (await action!.handler({}, ctx())) as Metrics;
    expect(r.commitmentReliability).toBe(100); // only the one real sprint counts
  });

  it("is null when an explicit velocities array is supplied (no commitment data)", async () => {
    const action = registry.get("tool.velocity.compute");
    const r = (await action!.handler({ velocities: [10, 20, 30] }, ctx())) as Metrics;
    expect(r.commitmentReliability).toBeNull();
    // The CV consistency score is still computed.
    expect(typeof r.predictability).toBe("number");
  });
});
