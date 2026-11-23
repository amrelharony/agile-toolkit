/**
 * tool.kanban.* for the Definition of Workflow and blocked spells: the
 * workflow verbs read and write the one definition (caps, null clears, a
 * checked target mix, versions with the board's WIP limits, the compare),
 * set_blocked writes the flag and the note on its spell, and the MCP
 * branches of add_card and move_card stamp blocked spells as the store's
 * own writes do: a card added blocked opens one, a move into Done closes it.
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

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  WORKFLOW_DEFINITION_ID,
  WORKFLOW_DEFINITION_KIND,
  type KanbanBoard,
  type KanbanCard,
  type Story,
  type WorkflowDefinition,
} from "@/lib/stores/workspace-types";
import { targetSplitOf } from "@/lib/flow/work-types";
import "@/lib/actions/tools/kanban";

const KIND_BOARD = "workspace:kanbanBoard";
const LIMITS = { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 };

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const mcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};

const card = (id: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title: id,
  column: "in_progress",
  class: "standard",
  createdAt: "2026-11-01",
  ...patch,
});
const doneCard = (id: string, start: string, end: string) =>
  card(id, {
    column: "done",
    startedAt: `${start}T09:00:00.000Z`,
    completedAt: `${end}T15:00:00.000Z`,
  });

const def = () =>
  (useWorkspaceStore.getState().workflowDefinitions ?? []).find(
    (d) => d.id === WORKFLOW_DEFINITION_ID
  );
const boardCard = (id: string) =>
  (useWorkspaceStore.getState().kanbanBoards ?? [])[0]?.cards.find((c) => c.id === id);
const serverBoard = () => rows.get(`${KIND_BOARD}/${KANBAN_BOARD_ID}`) as KanbanBoard;
const serverDef = () =>
  rows.get(`${WORKFLOW_DEFINITION_KIND}/${WORKFLOW_DEFINITION_ID}`) as WorkflowDefinition;

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({
    workflowDefinitions: [],
    stories: [],
    kanbanBoards: [{ id: KANBAN_BOARD_ID, cards: [], wipLimits: LIMITS }],
  });
});

describe("registration", () => {
  it("reads and writes, all on both transports, none a room verb", () => {
    const verbs: [string, "read" | "write"][] = [
      ["get_workflow", "read"],
      ["compare_workflow_version", "read"],
      ["update_workflow", "write"],
      ["save_workflow_version", "write"],
      ["set_blocked", "write"],
    ];
    for (const [name, category] of verbs) {
      const a = registry.get(`tool.kanban.${name}`);
      expect(a?.category, name).toBe(category);
      expect(a?.mcpHandler, name).toBeTypeOf("function");
      expect(a?.visitor, name).not.toBe(false);
      if (category === "write") expect(a?.requiresConfirmation, name).toBe(false);
      // Agents get a real schema, not the permissive {} a failed conversion leaves.
      expect(Object.keys(zodToJsonSchema(a!.paramsSchema)), name).toContain("type");
    }
    const update = zodToJsonSchema(registry.get("tool.kanban.update_workflow")!.paramsSchema);
    expect(Object.keys((update as { properties: object }).properties)).toEqual(
      expect.arrayContaining(["policies", "sle", "statik", "cadences", "targetSplit"])
    );
  });
});

describe("update_workflow and get_workflow", () => {
  it("creates the definition, then merges a change with null clearing", async () => {
    const first = await run<{ ok: boolean; updated: boolean }>("tool.kanban.update_workflow", {
      board: "flow",
      workItem: "A support request",
      pullPolicy: "Oldest first",
      policies: [
        { stage: "review", exit: "Checked by someone else" },
        { stage: "done", enter: "Shipped" },
      ],
      cadences: [{ name: "Replenishment", cadence: "weekly", minutes: 30 }],
    });
    expect(first).toMatchObject({ ok: true, updated: true });
    expect(def()).toMatchObject({
      board: "flow",
      workItem: "A support request",
      policies: [{ stage: "review", exit: "Checked by someone else" }],
    });
    expect(def()?.cadences?.[0]).toMatchObject({ name: "Replenishment", minutes: 30 });
    expect(def()?.cadences?.[0].id).toMatch(/^cadence-/);

    await run("tool.kanban.update_workflow", { pullPolicy: null, statik: { inside: "Too much" } });
    expect(def()?.pullPolicy).toBeUndefined();
    expect(def()?.workItem).toBe("A support request");
    await run("tool.kanban.update_workflow", { statik: { demand: "Twelve a week" } });
    expect(def()?.statik).toEqual({ inside: "Too much", demand: "Twelve a week" });

    const again = await run<{ updated: boolean }>("tool.kanban.update_workflow", {
      board: "flow",
    });
    expect(again.updated).toBe(false);
  });

  it("checks a target mix and keeps each type's meaning", async () => {
    await run("tool.kanban.update_workflow", { meanings: { debt: "Clean-up" } });
    const bad = await run<{ ok: boolean; error: string; hint: string }>(
      "tool.kanban.update_workflow",
      { targetSplit: { feature: 60, defect: 20, debt: 10, risk: 5 } }
    );
    expect(bad).toMatchObject({ ok: false, error: "bad_target_split" });
    expect(bad.hint).toMatch(/add up to 95/);
    await run("tool.kanban.update_workflow", {
      targetSplit: { feature: 60, defect: 20, debt: 15, risk: 5 },
    });
    expect(targetSplitOf(def())).toEqual({ feature: 60, defect: 20, debt: 15, risk: 5 });
    expect(def()?.workTypes?.find((w) => w.type === "debt")?.meaning).toBe("Clean-up");
    await run("tool.kanban.update_workflow", { targetSplit: null });
    expect(targetSplitOf(def())).toBeNull();
  });

  it("refuses text over the caps", () => {
    const params = registry.get("tool.kanban.update_workflow")!.paramsSchema;
    expect(params.safeParse({ workItem: "x".repeat(201) }).success).toBe(false);
    expect(params.safeParse({ sle: { days: 8, pct: 80 } }).success).toBe(false);
    expect(params.safeParse({ sle: { days: 400, pct: 85 } }).success).toBe(false);
    expect(params.safeParse({ statik: { inside: "x".repeat(1001) } }).success).toBe(false);
    expect(params.safeParse({ sle: { days: 8, pct: 85 } }).success).toBe(true);
  });

  it("reads the definition with the board's limits and an SLE from history", async () => {
    useWorkspaceStore.setState({
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          wipLimits: LIMITS,
          cards: [1, 2, 3, 4, 8].map((d, i) =>
            doneCard(`c${i}`, "2026-10-01", `2026-10-${String(d).padStart(2, "0")}`)
          ),
        },
      ],
    });
    const none = await run<{ exists: boolean; board: null }>("tool.kanban.get_workflow");
    expect(none).toMatchObject({ exists: false, board: null, sleFromHistory: null });
    await run("tool.kanban.update_workflow", { board: "flow", sle: { days: 8, pct: 85 } });
    const out = await run<{
      board: string;
      wipLimits: unknown;
      sleFromHistory: unknown;
      definition: WorkflowDefinition;
    }>("tool.kanban.get_workflow");
    expect(out.board).toBe("flow");
    expect(out.wipLimits).toEqual(LIMITS);
    expect(out.sleFromHistory).toEqual({ days: 8, pct: 85, sample: 5 });
    expect(out.definition.sle).toEqual({ days: 8, pct: 85 });
  });
});

describe("versions", () => {
  it("refuses a version before there is a definition", async () => {
    expect(await run("tool.kanban.save_workflow_version", {})).toMatchObject({
      ok: false,
      error: "no_workflow",
    });
    expect(await run("tool.kanban.compare_workflow_version", {})).toMatchObject({
      ok: false,
      error: "no_version",
    });
  });

  it("saves a numbered version with the board's WIP limits and compares it", async () => {
    await run("tool.kanban.update_workflow", { board: "flow" });
    const saved = await run<{ ok: boolean; version: number }>("tool.kanban.save_workflow_version", {
      note: "Review WIP 2",
      expect: "Shorter cycle time",
    });
    expect(saved).toMatchObject({ ok: true, version: 1 });
    expect(def()?.versions?.[0]).toMatchObject({
      version: 1,
      note: "Review WIP 2",
      expect: "Shorter cycle time",
      snapshot: { board: "flow", wipLimits: LIMITS },
    });
    const compare = await run<{ ok: boolean; weeks: number; cutShort: boolean }>(
      "tool.kanban.compare_workflow_version",
      { weeks: 2 }
    );
    expect(compare).toMatchObject({
      ok: true,
      board: "flow",
      version: 1,
      weeks: 2,
      cutShort: true,
    });
    expect(await run("tool.kanban.compare_workflow_version", { version: 9 })).toMatchObject({
      ok: false,
      error: "no_version",
    });
  });
});

describe("set_blocked", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          wipLimits: LIMITS,
          cards: [card("a"), card("d", { column: "done" }), card("example-x")],
        },
      ],
    })
  );

  it("opens a spell with the cause, the cluster and its side", async () => {
    const out = await run<{ ok: boolean; blocked: boolean; spell: Record<string, unknown> }>(
      "tool.kanban.set_blocked",
      { cardId: "a", blocked: true, cause: "Waiting on sandbox keys", cluster: "Another team" }
    );
    expect(out).toMatchObject({ ok: true, blocked: true });
    expect(out.spell).toMatchObject({
      cause: "Waiting on sandbox keys",
      cluster: "Another team",
      side: "external",
    });
    const log = boardCard("a")?.blockLog;
    expect(log).toHaveLength(1);
    expect(log?.[0].to).toBeUndefined();
    expect(boardCard("a")?.blocked).toBe(true);

    const off = await run<{ spell: { to?: string; cause?: string } }>("tool.kanban.set_blocked", {
      cardId: "a",
      blocked: false,
      cause: "Keys came on Friday",
    });
    expect(off.spell.to).toBeTruthy();
    expect(off.spell.cause).toBe("Keys came on Friday");
    expect(boardCard("a")?.blocked).toBeUndefined();
  });

  it("refuses example cards, cards in Done and unknown cards", async () => {
    expect(
      await run("tool.kanban.set_blocked", { cardId: "example-x", blocked: true })
    ).toMatchObject({ ok: false, error: "example" });
    expect(await run("tool.kanban.set_blocked", { cardId: "d", blocked: true })).toMatchObject({
      ok: false,
      error: "done",
    });
    expect(await run("tool.kanban.set_blocked", { cardId: "zz", blocked: true })).toMatchObject({
      ok: false,
      error: "not_found",
    });
  });

  it("writes the spell over MCP too", async () => {
    rows.set(`${KIND_BOARD}/${KANBAN_BOARD_ID}`, {
      id: KANBAN_BOARD_ID,
      wipLimits: LIMITS,
      cards: [card("a")],
    });
    const out = await mcp<{ ok: boolean }>("tool.kanban.set_blocked", {
      cardId: "a",
      blocked: true,
      cluster: "Waiting for a review",
    });
    expect(out.ok).toBe(true);
    const spell = serverBoard().cards[0].blockLog?.[0];
    expect(spell).toMatchObject({ cluster: "Waiting for a review", side: "internal" });
  });
});

describe("MCP stamps on add_card and move_card", () => {
  it("opens a spell for a card added blocked, and a move into Done closes it", async () => {
    const added = await mcp<{ id: string }>("tool.kanban.add_card", {
      title: "Wallet payments",
      column: "in_progress",
      blocked: true,
    });
    let stored = serverBoard().cards.find((c) => c.id === added.id)!;
    expect(stored.blocked).toBe(true);
    expect(stored.blockLog).toHaveLength(1);
    expect(stored.blockLog?.[0].to).toBeUndefined();

    await mcp("tool.kanban.move_card", { cardId: added.id, column: "done" });
    stored = serverBoard().cards.find((c) => c.id === added.id)!;
    expect(stored.blocked).toBeUndefined();
    expect(stored.blockLog?.[0].to).toBeTruthy();
  });

  it("leaves a card added unblocked without a log", async () => {
    const added = await mcp<{ id: string }>("tool.kanban.add_card", { title: "Receipts" });
    expect(serverBoard().cards.find((c) => c.id === added.id)?.blockLog).toBeUndefined();
  });
});

describe("the workflow verbs over MCP", () => {
  it("write the definition and read the stories for a Sprint-board definition", async () => {
    const stories: Story[] = [1, 2, 3, 4, 5].map((n) => ({
      id: `s${n}`,
      title: `S${n}`,
      status: "done",
      startedAt: "2026-10-01T09:00:00.000Z",
      doneAt: `2026-10-0${n + 1}T15:00:00.000Z`,
    }));
    for (const s of stories) rows.set(`workspace:story/${s.id}`, s);
    await mcp("tool.kanban.update_workflow", { board: "sprint", workItem: "A story" });
    expect(serverDef()).toMatchObject({ board: "sprint", workItem: "A story" });
    const out = await mcp<{ board: string; sleFromHistory: { days: number; sample: number } }>(
      "tool.kanban.get_workflow"
    );
    expect(out.board).toBe("sprint");
    expect(out.sleFromHistory).toMatchObject({ days: 6, sample: 5 });
    const saved = await mcp<{ version: number }>("tool.kanban.save_workflow_version", {});
    expect(saved.version).toBe(1);
    expect(serverDef().versions?.[0].snapshot.wipLimits).toEqual(LIMITS);
  });
});
