import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * tool.value_effort_matrix.place_item and set_position on both transports:
 * a move writes value and effort (through to a linked backlog item, as the
 * page's drag does), set_position with both null sends an item back to
 * "Not placed yet", one without the other is refused, and un-placing a
 * linked row clears the item's effort but keeps its value (WSJF's
 * business value too), as the page does, unless clearBacklog asks.
 */

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
    serverBulkUpsertEntities: vi.fn(async (_u: string, kind: string, list: { id: string }[]) => {
      for (const e of list) server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import "@/lib/actions/tools/value-effort-matrix";

const ctx = () => ({ userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] });
const browser = async <T>(id: string, params: unknown) =>
  (await registry.get(id)!.handler(params as never, ctx())) as T;
const mcp = async <T>(id: string, params: unknown) => {
  const a = registry.get(id)!;
  return (await (a.mcpHandler ?? a.handler)(params as never, ctx())) as T;
};

const STAMP = "2026-10-20T09:00:00.000Z";
const row = (id: string, fields: Record<string, number>, backlogItemId?: string) =>
  ({
    id,
    framework: "value-effort",
    title: `Row ${id}`,
    fields,
    score: undefined,
    status: "open",
    updatedAt: STAMP,
    ...(backlogItemId ? { backlogItemId } : {}),
  }) as PrioritizationItem;
const item = (id: string, partial: Partial<BacklogItem> = {}): BacklogItem =>
  ({ id, name: `Item ${id}`, createdAt: STAMP, ...partial }) as BacklogItem;

const state = () => useWorkspaceStore.getState();
const storedRow = (id: string) => (state().prioritizations ?? []).find((r) => r.id === id);
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const serverRow = (id: string) =>
  server.rows.get(`workspace:prioritization/${id}`) as PrioritizationItem | undefined;
const serverItem = (id: string) =>
  server.rows.get(`workspace:backlogItem/${id}`) as BacklogItem | undefined;

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("tool.value_effort_matrix.set_position", () => {
  it("registers as a write with the other verbs", () => {
    expect(registry.get("tool.value_effort_matrix.set_position")?.category).toBe("write");
    expect(registry.get("tool.value_effort_matrix.place_item")?.category).toBe("write");
  });

  it("places a tray item and derives its quadrant, as the page's drag", async () => {
    useWorkspaceStore.setState({ prioritizations: [row("t", {})] });
    const r = await browser<{ quadrant: string; score: number; placed: boolean }>(
      "tool.value_effort_matrix.set_position",
      { id: "t", value: 13, effort: 3 }
    );
    expect(r).toMatchObject({ quadrant: "quick_wins", placed: true });
    expect(r.score).toBeCloseTo(13 / 3);
    expect(storedRow("t")?.fields).toEqual({ businessValue: 13, effort: 3 });
    expect(storedRow("t")?.status).toBe("scored");
  });

  it("sends a placed item back to Not placed yet with both null", async () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", { businessValue: 8, effort: 2 })] });
    const r = await browser<{ quadrant: null; score: null; placed: boolean }>(
      "tool.value_effort_matrix.set_position",
      { id: "a", value: null, effort: null }
    );
    expect(r).toMatchObject({ quadrant: null, score: null, placed: false });
    expect(storedRow("a")?.fields).toEqual({});
    expect(storedRow("a")?.score).toBeUndefined();
    expect(storedRow("a")?.status).toBe("open");
  });

  it("refuses one without the other, as the page's form", () => {
    const schema = registry.get("tool.value_effort_matrix.set_position")!.paramsSchema;
    expect(schema.safeParse({ id: "a", value: 8, effort: null }).success).toBe(false);
    expect(schema.safeParse({ id: "a", value: null, effort: 3 }).success).toBe(false);
    expect(schema.safeParse({ id: "a", value: null, effort: null }).success).toBe(true);
  });

  it("refuses a value off the Fibonacci scale unless the row already holds it", async () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", { businessValue: 2, effort: 2 })] });
    await expect(
      browser("tool.value_effort_matrix.set_position", { id: "a", value: 7, effort: 2 })
    ).rejects.toThrow("Value is one of 1, 2, 3, 5, 8, 13 or 20.");
    expect(storedRow("a")?.fields).toEqual({ businessValue: 2, effort: 2 });
  });

  it("writes a linked row's move through to the backlog item on the server", async () => {
    server.rows.set("workspace:backlogItem/b1", item("b1", { businessValue: 3, matrixEffort: 4 }));
    server.rows.set("workspace:prioritization/a", row("a", { businessValue: 20, effort: 9 }, "b1"));
    const r = await mcp<{ quadrant: string; backlogUpdated: string[] }>(
      "tool.value_effort_matrix.set_position",
      { id: "a", value: 13, effort: 4 }
    );
    expect(r.quadrant).toBe("quick_wins");
    expect(r.backlogUpdated).toEqual(["businessValue"]);
    expect(serverItem("b1")).toMatchObject({ businessValue: 13, matrixEffort: 4 });
    expect(serverRow("a")?.fields).toEqual({ businessValue: 13, effort: 4 });
  });

  it("un-places a linked row by its effort, keeping WSJF's value, as the page does", async () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { businessValue: 8, matrixEffort: 2 })],
      prioritizations: [row("a", { businessValue: 8, effort: 2 }, "b1")],
    });
    const r = await browser<{ quadrant: null; placed: boolean; backlogUpdated: string[] }>(
      "tool.value_effort_matrix.set_position",
      { id: "a", value: null, effort: null }
    );
    expect(r).toMatchObject({ quadrant: null, placed: false, backlogUpdated: ["matrixEffort"] });
    expect(storedItem("b1")?.businessValue).toBe(8);
    expect(storedItem("b1")?.matrixEffort).toBeUndefined();
    expect(storedRow("a")?.fields).toEqual({ businessValue: 8 });
    expect(storedRow("a")?.status).toBe("open");
  });

  it("clears the item's value too with clearBacklog", async () => {
    useWorkspaceStore.setState({
      backlogItems: [item("b1", { businessValue: 8, matrixEffort: 2, value: 5 })],
      prioritizations: [row("a", { businessValue: 8, effort: 2 }, "b1")],
    });
    const r = await browser<{ backlogUpdated: string[]; placed: boolean }>(
      "tool.value_effort_matrix.set_position",
      { id: "a", value: null, effort: null, clearBacklog: true }
    );
    expect(r.placed).toBe(false);
    expect(r.backlogUpdated.sort()).toEqual(["businessValue", "matrixEffort"]);
    const saved = storedItem("b1")!;
    expect(saved.businessValue).toBeUndefined();
    expect(saved.matrixEffort).toBeUndefined();
    // The legacy value can't come back as a business value once it's cleared.
    expect(saved.value).toBeUndefined();
    expect(saved.updatedAt).toBeTruthy();
  });

  it("clears the value with clearBacklog even while WSJF's other parts are set", async () => {
    const wsjfToo = item("b1", {
      businessValue: 8,
      timeCriticality: 8,
      riskReduction: 3,
      jobSize: 5,
      matrixEffort: 3,
      updatedAt: STAMP,
    });
    const linked = row("a", { businessValue: 8, effort: 3 }, "b1");
    for (const [run, stored] of [
      [browser, storedItem],
      [mcp, serverItem],
    ] as const) {
      useWorkspaceStore.setState({ backlogItems: [wsjfToo], prioritizations: [linked] });
      server.rows.set("workspace:backlogItem/b1", wsjfToo);
      server.rows.set("workspace:prioritization/a", linked);
      const r = await run<{ backlogUpdated: string[] }>("tool.value_effort_matrix.set_position", {
        id: "a",
        value: null,
        effort: null,
        clearBacklog: true,
      });
      expect(r.backlogUpdated.sort()).toEqual(["businessValue", "matrixEffort"]);
      const saved = stored("b1")!;
      expect(saved).not.toHaveProperty("businessValue");
      expect(saved).not.toHaveProperty("matrixEffort");
      // WSJF's other parts stay; WSJF now waits for a business value.
      expect(saved).toMatchObject({ timeCriticality: 8, riskReduction: 3, jobSize: 5 });
    }
    // Without it, the value stays while WSJF uses it, as the page does.
    useWorkspaceStore.setState({ backlogItems: [wsjfToo], prioritizations: [linked] });
    const kept = await browser<{ backlogUpdated: string[] }>(
      "tool.value_effort_matrix.set_position",
      { id: "a", value: null, effort: null }
    );
    expect(kept.backlogUpdated).toEqual(["matrixEffort"]);
    expect(storedItem("b1")?.businessValue).toBe(8);
  });

  it("names an unknown id", async () => {
    await expect(
      browser("tool.value_effort_matrix.set_position", { id: "gone", value: null, effort: null })
    ).rejects.toThrow("No Value vs Effort item gone");
    await expect(
      mcp("tool.value_effort_matrix.set_position", { id: "gone", value: 1, effort: 1 })
    ).rejects.toThrow("No Value vs Effort item gone");
  });
});
