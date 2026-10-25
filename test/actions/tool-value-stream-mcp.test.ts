/**
 * tool.value_stream.* over MCP: the server reads the stage rows sorted by
 * id, so for a map saved before stages kept a position it can't know the
 * order the user built. It must never renumber such a map from what it
 * reads (that order would be saved for every device): add_stage adds last
 * without numbering, move_stage and start_future_state refuse with
 * 'order_unknown'. Once the map is numbered they work as in the browser.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValueStreamStage } from "@/lib/stores/workspace-types";

// The server's rows: listed sorted by entity id, as serverListEntities does.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([key]) => key.startsWith(`${kind}/`))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { orderedStages } from "@/lib/value-stream/summary";
import "@/lib/actions/tools/value-stream";

const KIND = "workspace:valueStreamStage";
const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };

const stage = (p: Partial<ValueStreamStage> & Pick<ValueStreamStage, "id">): ValueStreamStage => ({
  name: p.id,
  processTime: 1,
  leadTime: 2,
  completeAccurate: 100,
  ...p,
});

const seed = (stages: ValueStreamStage[]) => {
  for (const s of stages) rows.set(`${KIND}/${s.id}`, s);
};
const stored = () =>
  Array.from(rows.entries())
    .filter(([k]) => k.startsWith(`${KIND}/`))
    .map(([, v]) => v) as ValueStreamStage[];
const mcp = <T>(name: string, params: Record<string, unknown> = {}) =>
  registry.get(`tool.value_stream.${name}`)!.mcpHandler!(params, ctx) as Promise<T>;

// Built in this order on the user's device, with random ids that sort otherwise.
const LEGACY = [stage({ id: "zz-plan" }), stage({ id: "aa-build" }), stage({ id: "mm-ship" })];

beforeEach(() => {
  rows.clear();
  vi.mocked(serverStore.serverUpsertEntity).mockClear();
});

describe("tool.value_stream over MCP, on a map saved before reordering", () => {
  it("lists it with orderKnown false, so the agent knows the order is the rows'", async () => {
    seed(LEGACY);
    const r = await mcp<{ orderKnown: boolean; stages: { id: string }[] }>("list_state");
    expect(r.orderKnown).toBe(false);
    expect(r.stages.map((s) => s.id)).toEqual(["aa-build", "mm-ship", "zz-plan"]);
  });

  it("adds a stage last without writing an order for the others", async () => {
    seed(LEGACY);
    const r = await mcp<{ added: boolean; order: number; orderKnown: boolean; id: string }>(
      "add_stage",
      { name: "Release", processTime: 1, leadTime: 2, completeAccurate: 100 }
    );
    expect(r).toMatchObject({ added: true, orderKnown: false });
    // Only the new row was written, and it carries no order either.
    expect(vi.mocked(serverStore.serverUpsertEntity)).toHaveBeenCalledTimes(1);
    expect(stored().every((s) => s.order === undefined)).toBe(true);
    // On the device that built the map, a pulled row is appended: it reads last there.
    const onDevice = [...LEGACY, stored().find((s) => s.id === r.id)!];
    expect(orderedStages(onDevice).map((s) => s.name)).toEqual([
      "zz-plan",
      "aa-build",
      "mm-ship",
      "Release",
    ]);
  });

  it("refuses to move a stage or copy the map, so the id order is never pinned", async () => {
    seed(LEGACY);
    expect(await mcp("move_stage", { id: "zz-plan", toIndex: 2 })).toEqual({
      moved: false,
      reason: "order_unknown",
      id: "zz-plan",
      state: "current",
    });
    expect(await mcp("start_future_state")).toEqual({
      created: 0,
      reason: "order_unknown",
      ids: [],
    });
    expect(vi.mocked(serverStore.serverUpsertEntity)).not.toHaveBeenCalled();
    // Unknown ids are still reported as such.
    expect(await mcp("move_stage", { id: "nope", toIndex: 0 })).toEqual({
      moved: false,
      reason: "not_found",
    });
  });
});

describe("tool.value_stream over MCP, on a numbered map", () => {
  const NUMBERED = [
    stage({ id: "zz-plan", order: 0 }),
    stage({ id: "aa-build", order: 1 }),
    stage({ id: "mm-ship", order: 2 }),
  ];

  it("reads the page's order, whatever the row order", async () => {
    seed(NUMBERED);
    const r = await mcp<{ orderKnown: boolean; stages: { id: string; order: number }[] }>(
      "list_state"
    );
    expect(r.orderKnown).toBe(true);
    expect(r.stages.map((s) => [s.id, s.order])).toEqual([
      ["zz-plan", 0],
      ["aa-build", 1],
      ["mm-ship", 2],
    ]);
  });

  it("moves, adds and copies as in the browser", async () => {
    seed(NUMBERED);
    expect(await mcp("move_stage", { id: "mm-ship", toIndex: 0 })).toMatchObject({
      moved: true,
      index: 0,
      order: ["mm-ship", "zz-plan", "aa-build"],
    });
    const added = await mcp<{ order: number; orderKnown: boolean }>("add_stage", {
      name: "Release",
      processTime: 1,
      leadTime: 1,
      completeAccurate: 100,
    });
    expect(added).toMatchObject({ order: 3, orderKnown: true });
    const copied = await mcp<{ created: number }>("start_future_state");
    expect(copied.created).toBe(4);
    expect(orderedStages(stored(), "future").map((s) => s.name)).toEqual([
      "mm-ship",
      "zz-plan",
      "aa-build",
      "Release",
    ]);
  });

  it("checks add_stage's values as the page does", async () => {
    const schema = registry.get("tool.value_stream.add_stage")!.paramsSchema;
    expect(
      schema.safeParse({ name: "x", processTime: 3, leadTime: 2, completeAccurate: 90 }).success
    ).toBe(false);
    expect(
      schema.safeParse({ name: "x", processTime: 0, leadTime: 0, completeAccurate: 90 }).success
    ).toBe(false);
  });
});
