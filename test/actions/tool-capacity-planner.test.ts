/**
 * tool.capacity_planner.* action coverage.
 *
 *   1. list_state (read) + add_member / set_config (write, mcpHandler, no confirm)
 *   2. list_state computes effective hours per member + team total using the
 *      same formula as the UI
 *   3. add_member appends (creating the plan if absent) with sensible defaults
 *   4. set_config patches only the provided fields
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityPlan } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/capacity-planner";

const CP_ID = "capacity-planner:current";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

function plan(partial: Partial<CapacityPlan> = {}): CapacityPlan {
  return {
    id: CP_ID,
    members: [],
    config: {
      sprintDays: 10,
      ceremonyOverhead: 15,
      focusFactor: 0.8,
      hoursPerDay: 8,
      pointsCommitted: "",
    },
    ...partial,
  };
}

describe("tool.capacity_planner — registration", () => {
  it("registers list_state (read) + add_member/set_config (write, mcpHandler, no confirm)", () => {
    expect(registry.get("tool.capacity_planner.list_state")?.category).toBe("read");
    for (const id of ["tool.capacity_planner.add_member", "tool.capacity_planner.set_config"]) {
      expect(registry.get(id)?.category).toBe("write");
      expect(registry.get(id)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(id)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.capacity_planner.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ capacityPlans: [] });
  });

  it("reports exists:false with no plan", async () => {
    const action = registry.get("tool.capacity_planner.list_state");
    const r = (await action!.handler({}, ctx())) as {
      exists: boolean;
      totalEffectiveHours: number;
    };
    expect(r.exists).toBe(false);
    expect(r.totalEffectiveHours).toBe(0);
  });

  it("computes effective hours per member and team total", async () => {
    useWorkspaceStore.getState().upsertCapacityPlan(
      plan({
        members: [
          { id: "m1", name: "Alice", role: "dev", availability: 100, daysOff: 0 },
          { id: "m2", name: "Bob", role: "dev", availability: 50, daysOff: 2 },
        ],
      })
    );
    // Alice: 10 days * 1.0 * 8h * 0.8 * (1-0.15) = 54.4
    // Bob:   8 days  * 0.5 * 8h * 0.8 * 0.85      = 21.76 -> 21.8
    const action = registry.get("tool.capacity_planner.list_state");
    const r = (await action!.handler({}, ctx())) as {
      memberCount: number;
      totalEffectiveHours: number;
      perMember: { name: string; effectiveHours: number }[];
    };
    expect(r.memberCount).toBe(2);
    expect(r.perMember.find((m) => m.name === "Alice")?.effectiveHours).toBeCloseTo(54.4, 1);
    expect(r.perMember.find((m) => m.name === "Bob")?.effectiveHours).toBeCloseTo(21.8, 1);
    expect(r.totalEffectiveHours).toBeCloseTo(76.2, 1);
  });
});

describe("tool.capacity_planner.add_member", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ capacityPlans: [] });
  });

  it("creates the plan and appends a member with defaults", async () => {
    const action = registry.get("tool.capacity_planner.add_member");
    const r = (await action!.handler({ name: "Carol" }, ctx())) as { added: boolean };
    expect(r.added).toBe(true);
    const stored = (useWorkspaceStore.getState().capacityPlans ?? []).find((p) => p.id === CP_ID);
    expect(stored?.members).toHaveLength(1);
    expect(stored?.members[0].name).toBe("Carol");
    expect(stored?.members[0].availability).toBe(100);
    expect(stored?.members[0].daysOff).toBe(0);
  });
});

describe("tool.capacity_planner.set_config", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ capacityPlans: [] });
  });

  it("patches only the provided config fields", async () => {
    useWorkspaceStore.getState().upsertCapacityPlan(plan());
    const action = registry.get("tool.capacity_planner.set_config");
    await action!.handler({ sprintDays: 14 }, ctx());
    const stored = (useWorkspaceStore.getState().capacityPlans ?? []).find((p) => p.id === CP_ID);
    expect(stored?.config.sprintDays).toBe(14);
    // unchanged
    expect(stored?.config.focusFactor).toBe(0.8);
    expect(stored?.config.hoursPerDay).toBe(8);
  });
});

describe("tool.capacity_planner per sprint", () => {
  const SPRINT_PLAN = "capacity-planner:sprint:s1";
  const member = { id: "m1", name: "Alice", role: "dev", availability: 100, daysOff: 0 };

  beforeEach(() => {
    useWorkspaceStore.setState({
      capacityPlans: [],
      sprints: [
        {
          id: "s0",
          name: "Sprint 0",
          startDate: "2026-09-28",
          endDate: "2026-10-09",
          pointsPlanned: 20,
          pointsCompleted: 20,
          status: "completed",
        },
      ],
    });
  });

  it("reads the sprint's own plan, else falls back to the general one", async () => {
    const list = registry.get("tool.capacity_planner.list_state")!;
    useWorkspaceStore.getState().upsertCapacityPlan(plan({ members: [member] }));
    const fallback = (await list.handler({ sprintId: "s1" }, ctx())) as {
      perSprint: boolean;
      planId: string;
    };
    expect(fallback).toMatchObject({ perSprint: false, planId: CP_ID });

    useWorkspaceStore
      .getState()
      .upsertCapacityPlan(plan({ id: SPRINT_PLAN, sprintId: "s1", members: [member] }));
    const own = (await list.handler({ sprintId: "s1" }, ctx())) as {
      perSprint: boolean;
      planId: string;
      capacityRatio: number;
      suggestedPoints: number;
    };
    // Everyone fully available: a normal sprint, so the velocity of 20 stands.
    expect(own).toMatchObject({
      perSprint: true,
      planId: SPRINT_PLAN,
      capacityRatio: 1,
      suggestedPoints: 20,
    });
  });

  it("adds members and patches config on the sprint's plan, creating it with its sprintId", async () => {
    await registry
      .get("tool.capacity_planner.add_member")!
      .handler({ name: "Dana", sprintId: "s1" }, ctx());
    await registry
      .get("tool.capacity_planner.set_config")!
      .handler({ sprintDays: 9, sprintId: "s1" }, ctx());
    const plans = useWorkspaceStore.getState().capacityPlans ?? [];
    expect(plans.map((p) => p.id)).toEqual([SPRINT_PLAN]);
    expect(plans[0]).toMatchObject({ sprintId: "s1", config: { sprintDays: 9 } });
    expect(plans[0].members.map((m) => m.name)).toEqual(["Dana"]);
  });

  it("rejects a set_config with only a sprintId", () => {
    const schema = registry.get("tool.capacity_planner.set_config")!.paramsSchema;
    expect(schema.safeParse({ sprintId: "s1" }).success).toBe(false);
    expect(schema.safeParse({ focusFactor: 0.7, sprintId: "s1" }).success).toBe(true);
  });
});
