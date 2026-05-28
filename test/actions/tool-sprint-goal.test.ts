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
