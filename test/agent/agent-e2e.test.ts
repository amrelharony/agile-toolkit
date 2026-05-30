import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeToolUse } from "@/lib/agent/execute-tool";
import type { ToolUseBlock } from "@/lib/agent/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";

// Load the REAL cross-tool intents into the singleton registry — this drives
// the agent end-to-end against production handlers, not stubs.
import "@/lib/actions/intents/plan-sprint";
import "@/lib/actions/intents/start-retro";
import "@/lib/actions/intents/create-okr-for-sprint";
import "@/lib/actions/intents/log-impediment-from-retro-card";
import "@/lib/actions/intents/summarize-workspace";

/**
 * Agent end-to-end: drive a realistic multi-step workflow through
 * `executeToolUse` against the real action registry + intent handlers + the
 * workspace store. Exercises name resolution, schema validation, the
 * confirm-card gate (approve AND deny), real cross-tool intent composition, and
 * the resulting store mutations — the integration the per-unit tests don't.
 */

const TEST_USER = "test-user";

const block = (name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({
  type: "tool_use",
  id: `tu_${name}`,
  name,
  input,
});

const sprint = (p: Partial<Sprint> & Pick<Sprint, "id" | "name">): Sprint =>
  ({
    status: "active",
    startDate: "2026-04-15",
    endDate: "2026-04-29",
    pointsPlanned: 40,
    ...p,
  }) as unknown as Sprint;
const story = (p: Partial<Story> & Pick<Story, "id" | "title">): Story =>
  ({ status: "backlog", ...p }) as unknown as Story;

beforeEach(() => {
  useWorkspaceStore.setState({
    teamMembers: [],
    sprints: [sprint({ id: "sp1", name: "Sprint 1" })],
    stories: [
      story({ id: "a", title: "A", points: 5, priorityScore: 90 }),
      story({ id: "b", title: "B", points: 3, priorityScore: 80 }),
      story({ id: "big", title: "Big", points: 99, priorityScore: 70 }),
    ],
    impediments: [],
    risks: [],
    okrs: [],
    decisions: [],
    techDebt: [],
    whiteboards: [],
    whiteboardObjects: [],
  });
});

describe("agent e2e — sprint planning workflow", () => {
  it("runs summarize → plan(commit) → start-retro as an agent would, with the confirm gate", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const opts = { userId: TEST_USER, confirm, autoApprove: false };

    // 1) Read the workspace (no confirmation for reads).
    const summary = await executeToolUse(block("intent.summarize_workspace", {}), opts);
    expect(summary.is_error).toBeUndefined();
    expect(JSON.parse(summary.content as string).counts.sprints).toBe(1);
    expect(confirm).not.toHaveBeenCalled();

    // 2) Plan the sprint and COMMIT — a write/intent, so confirm is prompted.
    const plan = await executeToolUse(
      block("intent.plan_sprint", { sprintId: "sp1", capacityPoints: 10, commit: true }),
      opts
    );
    expect(plan.is_error).toBeUndefined();
    expect(confirm).toHaveBeenCalledTimes(1);
    const planResult = JSON.parse(plan.content as string);
    expect(planResult.committed).toBe(true);
    expect(planResult.selected.map((s: { id: string }) => s.id)).toEqual(["a", "b"]); // 5+3 fit; big(99) doesn't

    // Cross-tool effect: the selected stories were assigned to the sprint.
    const stories = useWorkspaceStore.getState().stories;
    expect(stories.find((s) => s.id === "a")!.sprintId).toBe("sp1");
    expect(stories.find((s) => s.id === "a")!.status).toBe("todo");
    expect(stories.find((s) => s.id === "big")!.sprintId).toBeUndefined(); // not selected

    // 3) Start a retro board for the sprint.
    const retro = await executeToolUse(
      block("intent.start_retro_for_sprint", { sprintId: "sp1" }),
      opts
    );
    expect(retro.is_error).toBeUndefined();
    expect(JSON.parse(retro.content as string).framesAdded).toBe(3);
    expect(useWorkspaceStore.getState().whiteboards!).toHaveLength(1);

    // Two writes (plan + retro) each prompted once; the read did not.
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("a denied confirmation blocks the write — no side effect on the store", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const res = await executeToolUse(
      block("intent.log_impediment_from_retro_card", { text: "Flaky CI" }),
      { userId: TEST_USER, confirm, autoApprove: false }
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(res.is_error).toBe(true);
    expect(res.content).toContain("User denied");
    // The impediment was NOT created.
    expect(useWorkspaceStore.getState().impediments).toHaveLength(0);
  });

  it("autoApprove runs writes without prompting (headless / batch agent runs)", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const res = await executeToolUse(
      block("intent.log_impediment_from_retro_card", { text: "Outage", severity: "critical" }),
      { userId: TEST_USER, confirm, autoApprove: true }
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(res.is_error).toBeUndefined();
    expect(useWorkspaceStore.getState().impediments).toHaveLength(1);
  });

  it("surfaces malformed agent calls as tool errors, never throwing the turn", async () => {
    const opts = { userId: TEST_USER, confirm: vi.fn().mockResolvedValue(true), autoApprove: true };
    // Unknown tool.
    const unknown = await executeToolUse(block("intent.does_not_exist", {}), opts);
    expect(unknown.is_error).toBe(true);
    expect(unknown.content).toContain("Unknown tool");
    // Schema violation (missing required sprintId).
    const bad = await executeToolUse(block("intent.plan_sprint", { capacityPoints: 10 }), opts);
    expect(bad.is_error).toBe(true);
    expect(bad.content).toContain("Invalid input for intent.plan_sprint");
    // A handler that throws (unknown sprint) comes back as a tool error.
    const missing = await executeToolUse(
      block("intent.plan_sprint", { sprintId: "ghost", capacityPoints: 10 }),
      opts
    );
    expect(missing.is_error).toBe(true);
    expect(missing.content).toMatch(/Handler error: .*not found/i);
  });
});
