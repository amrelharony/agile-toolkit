/**
 * tool.sprint_review.* action coverage.
 *
 *   1. list_state (read) + add_feedback (write w/ mcpHandler, no confirm)
 *   2. list_state summarises feedback-by-category, checklist progress, demo
 *      minutes, and velocity completion %
 *   3. add_feedback appends an item (creating the review if absent) and
 *      requires a category (no silent default)
 *   4. send_feedback_to_backlog over MCP dates the story it makes
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SprintReview, Story } from "@/lib/stores/workspace-types";

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => server.rows.get(key(kind, id)) ?? null
    ),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/sprint-review";

const SR_ID = "sprint-review:current";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

function review(partial: Partial<SprintReview> = {}): SprintReview {
  return {
    id: SR_ID,
    sprintName: "Sprint Alpha",
    sprintNumber: "1",
    features: [],
    meetingDate: "",
    feedbackItems: [],
    checklistItems: [],
    committed: 0,
    completed: 0,
    totalBacklog: 0,
    backlogDone: 0,
    ...partial,
  };
}

describe("tool.sprint_review — registration", () => {
  it("registers list_state (read) and add_feedback (write + mcpHandler, no confirm)", () => {
    expect(registry.get("tool.sprint_review.list_state")?.category).toBe("read");
    expect(registry.get("tool.sprint_review.add_feedback")?.category).toBe("write");
    expect(registry.get("tool.sprint_review.add_feedback")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.sprint_review.add_feedback")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.sprint_review.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sprintReviews: [] });
  });

  it("reports exists:false when there is no review", async () => {
    const action = registry.get("tool.sprint_review.list_state");
    const r = (await action!.handler({}, ctx())) as { exists: boolean; features: number };
    expect(r.exists).toBe(false);
    expect(r.features).toBe(0);
  });

  it("summarises feedback, checklist, demo minutes, and velocity", async () => {
    useWorkspaceStore.getState().upsertSprintReview(
      review({
        features: [
          { id: "f1", name: "A", description: "", acceptanceCriteria: "", timeMinutes: 5 },
          { id: "f2", name: "B", description: "", acceptanceCriteria: "", timeMinutes: 10 },
        ],
        feedbackItems: [
          { id: "fb1", stakeholder: "PM", feedback: "great", category: "positive" },
          { id: "fb2", stakeholder: "Eng", feedback: "risk", category: "concern" },
          { id: "fb3", stakeholder: "QA", feedback: "idea", category: "suggestion" },
          { id: "fb4", stakeholder: "PO", feedback: "love it", category: "positive" },
        ],
        checklistItems: [
          { id: "c1", label: "env", checked: true },
          { id: "c2", label: "data", checked: false },
        ],
        committed: 40,
        completed: 30,
      })
    );

    const action = registry.get("tool.sprint_review.list_state");
    const r = (await action!.handler({}, ctx())) as {
      exists: boolean;
      features: number;
      totalDemoMinutes: number;
      feedback: {
        total: number;
        positive: number;
        concern: number;
        suggestion: number;
        notOnBacklog: number;
      };
      checklist: { done: number; total: number };
      velocity: { completionPct: number };
    };
    expect(r.exists).toBe(true);
    expect(r.features).toBe(2);
    expect(r.totalDemoMinutes).toBe(15);
    expect(r.feedback).toEqual({
      total: 4,
      positive: 2,
      concern: 1,
      suggestion: 1,
      notOnBacklog: 2,
    });
    expect(r.checklist).toEqual({ done: 1, total: 2 });
    expect(r.velocity.completionPct).toBe(75);
  });
});

describe("tool.sprint_review.add_feedback", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ sprintReviews: [] });
  });

  it("creates the singleton review when none exists and appends feedback", async () => {
    const action = registry.get("tool.sprint_review.add_feedback");
    const r = (await action!.handler(
      { stakeholder: "Dana", feedback: "ship it", category: "positive" },
      ctx()
    )) as { added: boolean; id: string };
    expect(r.added).toBe(true);

    const doc = (useWorkspaceStore.getState().sprintReviews ?? []).find((x) => x.id === SR_ID);
    expect(doc?.feedbackItems).toHaveLength(1);
    expect(doc?.feedbackItems[0].stakeholder).toBe("Dana");
  });

  it("appends to an existing review", async () => {
    useWorkspaceStore.getState().upsertSprintReview(
      review({
        feedbackItems: [{ id: "fb1", stakeholder: "X", feedback: "y", category: "concern" }],
      })
    );

    const action = registry.get("tool.sprint_review.add_feedback");
    await action!.handler({ stakeholder: "Eve", feedback: "nice", category: "suggestion" }, ctx());

    const doc = (useWorkspaceStore.getState().sprintReviews ?? []).find((x) => x.id === SR_ID);
    expect(doc?.feedbackItems).toHaveLength(2);
    const added = doc?.feedbackItems.find((f) => f.stakeholder === "Eve");
    expect(added?.category).toBe("suggestion");
  });

  it("requires a category: no silent default", async () => {
    const action = registry.get("tool.sprint_review.add_feedback");
    expect(await action!.handler({ stakeholder: "Eve", feedback: "nice" }, ctx())).toEqual({
      added: false,
      reason: "category_required",
    });
    expect(useWorkspaceStore.getState().sprintReviews).toEqual([]);
  });
});

describe("tool.sprint_review.send_feedback_to_backlog over MCP", () => {
  beforeEach(() => server.rows.clear());

  it("writes the user's story with the date it was added", async () => {
    server.rows.set(
      `workspace:sprintReview/${SR_ID}`,
      review({
        feedbackItems: [
          {
            id: "f1",
            stakeholder: "Dana",
            feedback: "Let customers refund a payment themselves",
            category: "suggestion",
          },
        ],
      })
    );
    const action = registry.get("tool.sprint_review.send_feedback_to_backlog")!;
    const r = (await action.mcpHandler!(action.paramsSchema.parse({ feedbackId: "f1" }), {
      ...ctx(),
      source: "mcp" as const,
    })) as { sent: boolean; storyId: string };
    expect(r.sent).toBe(true);
    const story = server.rows.get(`workspace:story/${r.storyId}`) as Story;
    expect(story).toMatchObject({
      status: "backlog",
      sourceRef: { tool: "sprint-review", id: "f1" },
    });
    // Dated as a story the browser adds, so Backlog Health can call it stale later.
    expect(Date.parse(story.createdAt ?? "")).not.toBeNaN();
  });
});
