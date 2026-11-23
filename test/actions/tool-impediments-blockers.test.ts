/**
 * tool.impediments.list_blockers, set_cluster and raise_cluster: Amr reads
 * where the blocked time goes, clusters an impediment or a blocked spell
 * (stamped and cleaned as the CRUDs do on the server), and raises a whole
 * cluster as one impediment, refusing a second while one is open. The two
 * verbs the page had (list_state, set_status) keep their shape.
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
  type Impediment,
  type KanbanBoard,
  type KanbanCard,
  type Story,
} from "@/lib/stores/workspace-types";
import "@/lib/actions/tools/impediments";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const mcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const dayAgo = (days: number) => ago(days).slice(0, 10);

const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "in_progress",
  sprintId: "s1",
  ...patch,
});
const card = (id: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title: `Card ${id}`,
  column: "in_progress",
  class: "standard",
  createdAt: dayAgo(5),
  ...patch,
});
const board = (cards: KanbanCard[]): KanbanBoard => ({
  id: KANBAN_BOARD_ID,
  cards,
  wipLimits: { backlog: 0, ready: 0, in_progress: 3, review: 2, done: 0 },
});
const imp = (id: string, patch: Partial<Impediment> = {}): Impediment => ({
  id,
  title: `Impediment ${id}`,
  severity: "medium",
  raisedAt: dayAgo(3),
  ...patch,
});

const state = () => useWorkspaceStore.getState();

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({ stories: [], kanbanBoards: [], impediments: [] });
});

describe("registration", () => {
  it("keeps the page's two verbs and adds a read and two writes with server handlers", () => {
    expect(registry.get("tool.impediments.list_state")?.category).toBe("read");
    expect(registry.get("tool.impediments.set_status")?.category).toBe("write");
    expect(registry.get("tool.impediments.list_blockers")?.category).toBe("read");
    for (const id of ["set_cluster", "raise_cluster", "list_blockers"]) {
      const a = registry.get(`tool.impediments.${id}`);
      expect(a?.mcpHandler, id).toBeTypeOf("function");
      expect(a?.visitor, id).not.toBe(false);
    }
  });
});

describe("list_blockers", () => {
  it("ranks the clusters by blocked days and lists what isn't clustered", async () => {
    useWorkspaceStore.setState({
      stories: [
        story("a", { blockLog: [{ from: ago(6), to: ago(2), cluster: "Another team" }] }),
        story("b", { blocked: true, blockLog: [{ from: ago(1) }] }),
        story("example-c", { blockLog: [{ from: ago(6), to: ago(2), cluster: "Another team" }] }),
      ],
      impediments: [imp("i1", { cluster: "Waiting for a review" })],
    });
    const out = await run<{
      measure: string;
      clusters: { cluster: string; blockedDays: number; side: string }[];
      unclustered: { kind: string; id: string; spellFrom?: string }[];
      outsidePct: number | null;
      verdict: string;
    }>("tool.impediments.list_blockers", { days: 30 });
    expect(out.measure).toBe("blocked_days");
    expect(out.clusters[0]).toMatchObject({ cluster: "Another team", side: "external" });
    expect(out.clusters[0].blockedDays).toBeCloseTo(4, 0);
    expect(out.unclustered).toEqual([
      expect.objectContaining({ kind: "story", id: "b", spellFrom: expect.any(String) }),
    ]);
    expect(out.verdict).toMatch(/^Another team cost the most/);
  });

  it("reads the server's rows, ranking by impediments raised while nothing was blocked", async () => {
    rows.set("workspace:impediment/i1", imp("i1", { cluster: "Another team" }));
    rows.set("workspace:impediment/i2", imp("i2", { cluster: "Another team" }));
    const out = await mcp<{ measure: string; clusters: { impediments: number }[] }>(
      "tool.impediments.list_blockers"
    );
    expect(out.measure).toBe("impediments");
    expect(out.clusters[0].impediments).toBe(2);
  });
});

describe("set_cluster", () => {
  it("clusters an impediment, and clearing takes its side with it", async () => {
    useWorkspaceStore.setState({ impediments: [imp("i1")] });
    const out = await run("tool.impediments.set_cluster", {
      kind: "impediment",
      id: "i1",
      cluster: "  A decision   or approval ",
      side: "external",
    });
    expect(out).toEqual({
      ok: true,
      kind: "impediment",
      id: "i1",
      cluster: "A decision or approval",
      side: "external",
    });
    expect(state().impediments[0]).toMatchObject({
      cluster: "A decision or approval",
      blockSide: "external",
    });
    await run("tool.impediments.set_cluster", { kind: "impediment", id: "i1", cluster: null });
    expect(state().impediments[0]).not.toHaveProperty("cluster");
    expect(state().impediments[0]).not.toHaveProperty("blockSide");
  });

  it("notes a story's open spell, or starts one for a block from before tracking", async () => {
    useWorkspaceStore.setState({
      stories: [
        story("a", { blocked: true, blockLog: [{ from: ago(2) }] }),
        story("b", { blocked: true }),
      ],
    });
    await run("tool.impediments.set_cluster", { kind: "story", id: "a", cluster: "Another team" });
    expect(state().stories[0].blockLog?.[0]).toMatchObject({
      cluster: "Another team",
      side: "external",
    });
    await run("tool.impediments.set_cluster", {
      kind: "story",
      id: "b",
      cluster: "Test or build environment",
    });
    expect(state().stories[1].blockLog?.[0]).toMatchObject({
      earlier: true,
      cluster: "Test or build environment",
      side: "internal",
    });
  });

  it("clusters a card's spell by its start, and says when there is none", async () => {
    const from = ago(4);
    useWorkspaceStore.setState({
      kanbanBoards: [board([card("c1", { blockLog: [{ from, to: ago(3) }] })])],
    });
    await run("tool.impediments.set_cluster", {
      kind: "card",
      id: "c1",
      spellFrom: from,
      cluster: "Waiting for a review",
    });
    expect(state().kanbanBoards![0].cards[0].blockLog?.[0].cluster).toBe("Waiting for a review");
    expect(
      await run("tool.impediments.set_cluster", {
        kind: "card",
        id: "c1",
        spellFrom: "nope",
        cluster: "X",
      })
    ).toMatchObject({ ok: false, error: "no_spell" });
  });

  it("refuses examples and unknown ids in the house shape", async () => {
    expect(
      await run("tool.impediments.set_cluster", {
        kind: "impediment",
        id: "example-i",
        cluster: "X",
      })
    ).toMatchObject({ ok: false, error: "example_item", hint: expect.any(String) });
    expect(
      await run("tool.impediments.set_cluster", { kind: "story", id: "nope", cluster: "X" })
    ).toMatchObject({ ok: false, error: "not_found" });
  });

  it("stamps and cleans on the server", async () => {
    rows.set("workspace:story/a", story("a", { blocked: true, blockLog: [{ from: ago(2) }] }));
    rows.set(
      `workspace:kanbanBoard/${KANBAN_BOARD_ID}`,
      board([
        card("c1", { blocked: true, blockLog: [{ from: ago(2) }], workType: "nope" as never }),
      ])
    );
    await mcp("tool.impediments.set_cluster", { kind: "story", id: "a", cluster: "Another team" });
    expect((rows.get("workspace:story/a") as Story).blockLog?.[0].cluster).toBe("Another team");
    await mcp("tool.impediments.set_cluster", { kind: "card", id: "c1", cluster: "Another team" });
    const saved = rows.get(`workspace:kanbanBoard/${KANBAN_BOARD_ID}`) as KanbanBoard;
    expect(saved.cards[0].blockLog?.[0].cluster).toBe("Another team");
    expect(saved.cards[0]).not.toHaveProperty("workType");
  });
});

describe("raise_cluster", () => {
  it("raises a cluster as one impediment, then refuses a second while it is open", async () => {
    useWorkspaceStore.setState({
      stories: [
        story("a", {
          blockLog: [
            { from: ago(6), to: ago(2), cluster: "Another team", cause: "Waiting on the API team" },
          ],
        }),
      ],
    });
    const out = await run<{ ok: true; impediment: Impediment }>("tool.impediments.raise_cluster", {
      cluster: "Another team",
    });
    expect(out.ok).toBe(true);
    expect(out.impediment).toMatchObject({
      title: "Keeps blocking us: Another team",
      severity: "medium",
      category: "external",
      cluster: "Another team",
      blockSide: "external",
      source: "manual",
    });
    expect(out.impediment.description).toContain("1 item blocked for 4 days");
    expect(out.impediment.description).toContain("- Waiting on the API team");
    expect(state().impediments).toHaveLength(1);
    const again = await run("tool.impediments.raise_cluster", { cluster: "another TEAM" });
    expect(again).toEqual({
      ok: false,
      error: "already_raised",
      hint: expect.any(String),
      impedimentId: out.impediment.id,
    });
  });

  it("raises an inside cluster as a process impediment on the server", async () => {
    const out = await mcp<{ ok: true; impediment: Impediment }>("tool.impediments.raise_cluster", {
      cluster: "Waiting for a review",
    });
    expect(out.impediment).toMatchObject({ category: "process", blockSide: "internal" });
    expect(rows.get(`workspace:impediment/${out.impediment.id}`)).toEqual(out.impediment);
  });
});
