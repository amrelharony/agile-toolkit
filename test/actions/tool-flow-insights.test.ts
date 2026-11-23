/**
 * tool.flow_insights.* — Amr reads Flow Insights (the mix, the target,
 * repeat work, team stability and the verdict), lists the unsorted items,
 * sorts one, and sets the target mix, in the browser and on the MCP server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      rows.set(`${kind}/${e.id}`, e);
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  WORKFLOW_DEFINITION_ID,
  WORKFLOW_DEFINITION_KIND,
  type KanbanBoard,
  type KanbanCard,
  type Sprint,
  type Story,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import { targetSplitOf } from "@/lib/flow/work-types";
import "@/lib/actions/tools/flow-insights";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const mcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};

const sprint = (n: number): Sprint => ({
  id: `s${n}`,
  name: `Sprint ${n}`,
  startDate: `2026-0${n}-02`,
  endDate: `2026-0${n}-13`,
  pointsPlanned: 10,
  status: "completed",
});
const done = (id: string, sprintId: string, end: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  sprintId,
  doneAt: `${end}T12:00:00.000Z`,
  ...patch,
});
const card = (id: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title: `Card ${id}`,
  column: "done",
  class: "standard",
  createdAt: "2026-01-05",
  startedAt: "2026-01-05T09:00:00.000Z",
  completedAt: "2026-01-07T09:00:00.000Z",
  ...patch,
});
const board = (cards: KanbanCard[]): KanbanBoard => ({
  id: KANBAN_BOARD_ID,
  cards,
  wipLimits: { backlog: 0, ready: 0, in_progress: 3, review: 2, done: 0 },
});

const STORIES = [
  done("a", "s1", "2026-01-13", { owner: "Ana" }),
  done("b", "s1", "2026-01-13", { title: "Fix totals", owner: "Ana" }),
  done("c", "s2", "2026-02-13", { workType: "debt", owner: "Ben" }),
  done("example-d", "s2", "2026-02-13"),
];

const state = () => useWorkspaceStore.getState();

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({
    stories: [],
    sprints: [],
    kanbanBoards: [],
    capacityPlans: [],
    workflowDefinitions: [],
  });
});

describe("registration", () => {
  it("has two reads and two writes, each with a server handler and the default visitor flag", () => {
    for (const [id, category] of [
      ["list_state", "read"],
      ["list_unsorted", "read"],
      ["set_work_type", "write"],
      ["set_target_split", "write"],
    ] as const) {
      const a = registry.get(`tool.flow_insights.${id}`);
      expect(a?.category, id).toBe(category);
      expect(a?.mcpHandler, id).toBeTypeOf("function");
      expect(a?.visitor, id).not.toBe(false);
    }
  });
});

describe("list_state", () => {
  it("reads the mix per sprint, the target and the stability, without examples", async () => {
    useWorkspaceStore.setState({
      stories: STORIES,
      sprints: [sprint(1), sprint(2)],
      workflowDefinitions: [
        {
          id: WORKFLOW_DEFINITION_ID,
          workTypes: [
            { type: "feature", targetPct: 60 },
            { type: "defect", targetPct: 15 },
            { type: "debt", targetPct: 15 },
            { type: "risk", targetPct: 10 },
          ],
        },
      ],
    });
    const out = await run<{
      board: string;
      periods: { id: string; finished: number; defect: number; unsorted: number }[];
      target: unknown;
      stability: { joined: string[]; left: string[] }[];
      verdict: string;
    }>("tool.flow_insights.list_state");
    expect(out.board).toBe("sprint");
    expect(out.periods.map((p) => [p.id, p.finished, p.defect, p.unsorted])).toEqual([
      ["s1", 2, 1, 1],
      ["s2", 1, 0, 0],
    ]);
    expect(out.target).toEqual({ feature: 60, defect: 15, debt: 15, risk: 10 });
    expect(out.stability[1]).toMatchObject({ joined: ["Ben"], left: ["Ana"] });
    expect(out.verdict).toContain("3 items finished over the last 2 sprints");
  });

  it("reads the Flow board per week up to this week, on the server", async () => {
    const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    rows.set(
      `workspace:kanbanBoard/${KANBAN_BOARD_ID}`,
      board([
        card("c1", { startedAt: recent(30), completedAt: recent(29) }),
        card("c2", { startedAt: recent(30), completedAt: recent(29), workType: "risk" }),
        card("c3"),
      ])
    );
    const out = await mcp<{ board: string; periods: { finished: number; risk: number }[] }>(
      "tool.flow_insights.list_state",
      { board: "flow", periods: 12 }
    );
    expect(out.board).toBe("flow");
    // Quiet weeks up to this one are in the window; the January card is long before it.
    expect(out.periods).toHaveLength(12);
    const finished = out.periods.filter((p) => p.finished > 0);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ finished: 2, risk: 1 });
  });

  it("reads the page's 12 weeks when it picks the Flow board itself", async () => {
    // No finished sprint, so the default board is the Flow board.
    useWorkspaceStore.setState({ kanbanBoards: [board([card("c1")])] });
    const out = await run<{ board: string; periods: unknown[]; verdict: string }>(
      "tool.flow_insights.list_state"
    );
    expect(out.board).toBe("flow");
    expect(out.periods).toHaveLength(12);
    expect(out.verdict).not.toContain("6 weeks");
  });
});

describe("list_unsorted", () => {
  it("lists finished items with no type set, each with its guess", async () => {
    useWorkspaceStore.setState({
      stories: STORIES,
      sprints: [sprint(1), sprint(2)],
      kanbanBoards: [board([card("c1", { title: "Refactor the cart" })])],
    });
    const out = await run<{ items: { id: string; guess: string; guessedBy: string }[] }>(
      "tool.flow_insights.list_unsorted"
    );
    const byId = Object.fromEntries(out.items.map((i) => [i.id, i]));
    expect(Object.keys(byId).sort()).toEqual(["a", "b", "c1"]);
    expect(byId.b).toMatchObject({ guess: "defect", guessedBy: "kind" });
    expect(byId.c1).toMatchObject({ guess: "debt", guessedBy: "keywords" });
    const one = await run<{ items: unknown[] }>("tool.flow_insights.list_unsorted", {
      board: "flow",
      limit: 1,
    });
    expect(one.items).toHaveLength(1);
  });

  it("counts every unsorted item in total, past the limit", async () => {
    useWorkspaceStore.setState({ stories: STORIES, sprints: [sprint(1), sprint(2)] });
    const out = await run<{ total: number; items: unknown[] }>("tool.flow_insights.list_unsorted", {
      limit: 1,
    });
    expect(out.items).toHaveLength(1);
    expect(out.total).toBe(2);
  });
});

describe("set_work_type", () => {
  it("sets and clears a story's type and demand through the store", async () => {
    useWorkspaceStore.setState({ stories: [done("a", "s1", "2026-01-13")] });
    const out = await run("tool.flow_insights.set_work_type", {
      kind: "story",
      id: "a",
      type: "defect",
      demand: "failure",
    });
    expect(out).toEqual({ ok: true, kind: "story", id: "a", type: "defect", demand: "failure" });
    expect(state().stories[0]).toMatchObject({ workType: "defect", demand: "failure" });
    await run("tool.flow_insights.set_work_type", {
      kind: "story",
      id: "a",
      type: null,
      demand: null,
    });
    expect(state().stories[0]).not.toHaveProperty("workType");
    expect(state().stories[0]).not.toHaveProperty("demand");
  });

  it("sets a card's type on the board", async () => {
    useWorkspaceStore.setState({ kanbanBoards: [board([card("c1"), card("c2")])] });
    await run("tool.flow_insights.set_work_type", { kind: "card", id: "c2", type: "risk" });
    const cards = state().kanbanBoards![0].cards;
    expect(cards.find((c) => c.id === "c2")?.workType).toBe("risk");
    expect(cards.find((c) => c.id === "c1")).not.toHaveProperty("workType");
  });

  it("refuses examples and unknown ids in the house shape", async () => {
    expect(
      await run("tool.flow_insights.set_work_type", {
        kind: "story",
        id: "example-x",
        type: "debt",
      })
    ).toMatchObject({ ok: false, error: "example_item" });
    expect(
      await run("tool.flow_insights.set_work_type", { kind: "card", id: "nope", type: "debt" })
    ).toMatchObject({ ok: false, error: "not_found", hint: expect.any(String) });
  });

  it("stamps and cleans on the server, as the CRUDs do", async () => {
    rows.set("workspace:story/a", done("a", "s1", "2026-01-13"));
    rows.set(
      `workspace:kanbanBoard/${KANBAN_BOARD_ID}`,
      board([card("c1", { blockLog: [{ from: "not a time" }] as never, demand: "nope" as never })])
    );
    await mcp("tool.flow_insights.set_work_type", { kind: "story", id: "a", type: "feature" });
    expect(rows.get("workspace:story/a")).toMatchObject({ workType: "feature" });
    await mcp("tool.flow_insights.set_work_type", { kind: "card", id: "c1", type: "debt" });
    const saved = rows.get(`workspace:kanbanBoard/${KANBAN_BOARD_ID}`) as KanbanBoard;
    expect(saved.cards[0].workType).toBe("debt");
    expect(saved.cards[0]).not.toHaveProperty("blockLog");
    expect(saved.cards[0]).not.toHaveProperty("demand");
  });
});

describe("set_target_split", () => {
  it("sets the target mix on the workflow definition, and clears it", async () => {
    const out = await run("tool.flow_insights.set_target_split", {
      feature: 55,
      defect: 15,
      debt: 20,
      risk: 10,
    });
    expect(out).toEqual({ ok: true, target: { feature: 55, defect: 15, debt: 20, risk: 10 } });
    const def = state().workflowDefinitions!.find((d) => d.id === WORKFLOW_DEFINITION_ID);
    expect(targetSplitOf(def)).toEqual({ feature: 55, defect: 15, debt: 20, risk: 10 });
    await run("tool.flow_insights.set_target_split", {
      feature: null,
      defect: null,
      debt: null,
      risk: null,
    });
    expect(
      targetSplitOf(state().workflowDefinitions!.find((d) => d.id === WORKFLOW_DEFINITION_ID))
    ).toBeNull();
  });

  it("refuses a split that doesn't add up to 100", async () => {
    expect(
      await run("tool.flow_insights.set_target_split", {
        feature: 50,
        defect: 10,
        debt: 10,
        risk: 10,
      })
    ).toMatchObject({
      ok: false,
      error: "invalid_split",
      hint: expect.stringMatching(/add up to 80/),
    });
    expect(
      await run("tool.flow_insights.set_target_split", {
        feature: 50,
        defect: null,
        debt: 40,
        risk: 10,
      })
    ).toMatchObject({ ok: false, error: "invalid_split" });
  });

  it("writes the definition on the server, keeping what Kanban set", async () => {
    rows.set(`${WORKFLOW_DEFINITION_KIND}/${WORKFLOW_DEFINITION_ID}`, {
      id: WORKFLOW_DEFINITION_ID,
      workItem: "A user story",
      workTypes: [{ type: "debt", meaning: "Our clean-up" }],
    } satisfies WorkflowDefinition);
    await mcp("tool.flow_insights.set_target_split", {
      feature: 70,
      defect: 10,
      debt: 10,
      risk: 10,
    });
    const saved = rows.get(
      `${WORKFLOW_DEFINITION_KIND}/${WORKFLOW_DEFINITION_ID}`
    ) as WorkflowDefinition;
    expect(saved.workItem).toBe("A user story");
    expect(saved.workTypes?.find((w) => w.type === "debt")).toEqual({
      type: "debt",
      meaning: "Our clean-up",
      targetPct: 10,
    });
  });
});
