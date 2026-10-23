/**
 * tool.sprint_goal.* action coverage.
 *
 *   1. list_state (read) + set_goal / add_criterion (write, mcpHandler, no confirm)
 *   2. list_state reports exists:false empty, then objective/goal/criteria counts
 *   3. set_goal creates the singleton + patches only the provided fields
 *   4. add_criterion appends a criterion (creating the singleton if absent)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SprintGoal } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/sprint-goal";

const SG_ID = "sprint-goal:current";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

function doc(partial: Partial<SprintGoal> = {}): SprintGoal {
  return {
    id: SG_ID,
    businessObjective: "",
    goal: "",
    criteria: [],
    keyResults: [],
    ...partial,
  };
}

describe("tool.sprint_goal — registration", () => {
  it("registers list_state (read) and set_goal/add_criterion (write, mcpHandler, no confirm)", () => {
    expect(registry.get("tool.sprint_goal.list_state")?.category).toBe("read");
    for (const id of ["tool.sprint_goal.set_goal", "tool.sprint_goal.add_criterion"]) {
      expect(registry.get(id)?.category).toBe("write");
      expect(registry.get(id)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(id)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.sprint_goal.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sprintGoals: [] });
  });

  it("reports exists:false when no goal exists", async () => {
    const action = registry.get("tool.sprint_goal.list_state");
    const r = (await action!.handler({}, ctx())) as { exists: boolean; criteriaCount: number };
    expect(r.exists).toBe(false);
    expect(r.criteriaCount).toBe(0);
  });

  it("summarises objective, goal, and criteria", async () => {
    useWorkspaceStore.getState().upsertSprintGoal(
      doc({
        businessObjective: "Grow activation",
        goal: "Ship onboarding v2",
        criteria: [
          { id: "c1", text: "tutorial", relevantChecked: true },
          { id: "c2", text: "metrics", relevantChecked: false },
        ],
        keyResults: ["activation +10%"],
      })
    );
    const action = registry.get("tool.sprint_goal.list_state");
    const r = (await action!.handler({}, ctx())) as {
      exists: boolean;
      goal: string;
      criteriaCount: number;
      relevantCount: number;
    };
    expect(r.exists).toBe(true);
    expect(r.goal).toBe("Ship onboarding v2");
    expect(r.criteriaCount).toBe(2);
    expect(r.relevantCount).toBe(1);
  });
});

describe("tool.sprint_goal.set_goal", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sprintGoals: [] });
  });

  it("creates the singleton and patches only provided fields", async () => {
    const action = registry.get("tool.sprint_goal.set_goal");
    await action!.handler({ goal: "Reduce p95 latency" }, ctx());
    let stored = (useWorkspaceStore.getState().sprintGoals ?? []).find((g) => g.id === SG_ID);
    expect(stored?.goal).toBe("Reduce p95 latency");
    expect(stored?.businessObjective).toBe("");

    await action!.handler({ businessObjective: "Reliability" }, ctx());
    stored = (useWorkspaceStore.getState().sprintGoals ?? []).find((g) => g.id === SG_ID);
    // goal preserved, objective added
    expect(stored?.goal).toBe("Reduce p95 latency");
    expect(stored?.businessObjective).toBe("Reliability");
  });
});

describe("tool.sprint_goal.add_criterion", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sprintGoals: [] });
  });

  it("appends a criterion, creating the singleton if absent", async () => {
    const action = registry.get("tool.sprint_goal.add_criterion");
    const r = (await action!.handler({ text: "p95 < 200ms" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(r.added).toBe(true);
    const stored = (useWorkspaceStore.getState().sprintGoals ?? []).find((g) => g.id === SG_ID);
    expect(stored?.criteria).toHaveLength(1);
    expect(stored?.criteria[0].text).toBe("p95 < 200ms");
    expect(stored?.criteria[0].relevantChecked).toBe(false);
  });
});

describe("tool.sprint_goal per sprint", () => {
  const sprint = {
    id: "s1",
    name: "Sprint 1",
    startDate: "2026-10-19",
    endDate: "2026-10-30",
    pointsPlanned: 20,
    status: "active" as const,
  };
  const stored = (id: string) => useWorkspaceStore.getState().sprintGoals?.find((g) => g.id === id);

  beforeEach(() => {
    useWorkspaceStore.setState({
      sprintGoals: [],
      sprints: [{ ...sprint, goal: "Ship guest checkout" }],
    });
  });

  it("reads Sprint.goal for a sprint with no goal document yet", async () => {
    const r = (await registry
      .get("tool.sprint_goal.list_state")!
      .handler({ sprintId: "s1" }, ctx())) as { exists: boolean; goal: string; sprintGoal: string };
    expect(r).toMatchObject({
      exists: false,
      goal: "Ship guest checkout",
      sprintGoal: "Ship guest checkout",
    });
  });

  it("writes the sprint's own document and mirrors the statement to Sprint.goal", async () => {
    await registry
      .get("tool.sprint_goal.set_goal")!
      .handler({ goal: "Guests can pay without an account", sprintId: "s1" }, ctx());
    expect(stored("sprint-goal:sprint:s1")).toMatchObject({
      sprintId: "s1",
      goal: "Guests can pay without an account",
    });
    expect(stored(SG_ID)).toBeUndefined();
    expect(useWorkspaceStore.getState().sprints[0].goal).toBe("Guests can pay without an account");
  });

  it("links and unlinks OKRs idempotently", async () => {
    const link = registry.get("tool.sprint_goal.link_okr")!;
    const unlink = registry.get("tool.sprint_goal.unlink_okr")!;
    expect(await link.handler({ okrId: "o1", sprintId: "s1" }, ctx())).toEqual({ changed: true });
    expect(await link.handler({ okrId: "o1", sprintId: "s1" }, ctx())).toEqual({ changed: false });
    expect(stored("sprint-goal:sprint:s1")?.okrIds).toEqual(["o1"]);
    expect(await unlink.handler({ okrId: "o1", sprintId: "s1" }, ctx())).toEqual({ changed: true });
    expect(stored("sprint-goal:sprint:s1")?.okrIds).toEqual([]);
  });

  it("records the goal's outcome with a note", async () => {
    await registry
      .get("tool.sprint_goal.record_outcome")!
      .handler({ sprintId: "s1", met: "partly", note: "  Card payments only  " }, ctx());
    expect(stored("sprint-goal:sprint:s1")?.outcome).toMatchObject({
      met: "partly",
      note: "Card payments only",
      decidedAt: expect.any(String),
    });
    const schema = registry.get("tool.sprint_goal.record_outcome")!.paramsSchema;
    expect(schema.safeParse({ sprintId: "s1", met: "yes" }).success).toBe(false);
  });
});
