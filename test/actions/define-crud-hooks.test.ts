import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * defineCrudActions' write hooks, on both transports: `load` reads what a
 * write needs before `prepare`, `prepare` gets the caller's raw patch on
 * update, and `beforeWrite` runs last, may refuse (nothing is written) and
 * sees every record of the entity on its transport. `readAs` gives an
 * update the record its tool lists for the stored one, and `beforeDelete`
 * may refuse a delete. A versioned CRUD (a synchronous compare-and-set)
 * takes no async write hook.
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
    serverDeleteEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      server.rows.delete(key(kind, id));
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { defineCrudActions, type CrudEnv } from "@/lib/actions/define-crud";

const NS = "__test.hooked";
const KIND = "__test:hooked";
const IDS = ["create", "list", "update", "delete"].map((v) => `${NS}.${v}`);

interface Widget {
  id: string;
  name: string;
  size?: number;
}
const WidgetSchema = z.object({ id: z.string(), name: z.string(), size: z.number().optional() });

const ctx = () => ({ userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] });
const call = async <T>(verb: string, params: unknown, onServer: boolean) => {
  const a = registry.get(`${NS}.${verb}`)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(params as never, ctx())) as T;
};

let local: Widget[] = [];
const log: string[] = [];
let seen: { patch?: unknown; loaded?: unknown; userId?: string; all?: readonly Widget[] } = {};

function define() {
  defineCrudActions<Widget, { size: number }>({
    toolId: NS,
    serverKind: KIND,
    schema: WidgetSchema as unknown as z.ZodType<Widget>,
    entityName: "widget",
    selectAll: () => local,
    upsert: (w) => {
      log.push("upsert");
      local = [...local.filter((x) => x.id !== w.id), w];
    },
    remove: (id) => {
      local = local.filter((x) => x.id !== id);
    },
    load: async (current: Widget | undefined, env: CrudEnv<Widget>) => {
      log.push(`load:${current?.id ?? "new"}`);
      seen.userId = env.userId;
      return { size: 7 };
    },
    prepare: (next, _current, patch, loaded) => {
      log.push("prepare");
      seen.patch = patch;
      seen.loaded = loaded;
      return { ...next, size: loaded?.size };
    },
    beforeWrite: async (next, _current, env) => {
      log.push("beforeWrite");
      seen.all = await env.all();
      if (next.name === "refused") throw new Error("widget: refused. Nothing was saved.");
    },
  });
}

beforeEach(() => {
  local = [];
  log.length = 0;
  seen = {};
  server.rows.clear();
  define();
});
afterEach(() => {
  for (const id of IDS) registry.unregister(id);
});

describe.each([
  ["in the tab", false],
  ["over MCP", true],
] as const)("defineCrudActions' write hooks %s", (_where, onServer) => {
  const stored = (id: string) =>
    onServer
      ? (server.rows.get(`${KIND}/${id}`) as Widget | undefined)
      : local.find((w) => w.id === id);
  const seed = (w: Widget) => {
    if (onServer) server.rows.set(`${KIND}/${w.id}`, { ...w });
    else local = [{ ...w }];
  };

  it("runs load, prepare and beforeWrite in order, then writes what prepare made", async () => {
    await call("create", { entity: { id: "w1", name: "Bolt" } }, onServer);
    expect(log.filter((l) => l !== "upsert")).toEqual(["load:new", "prepare", "beforeWrite"]);
    expect(stored("w1")).toEqual({ id: "w1", name: "Bolt", size: 7 });
    expect(seen.loaded).toEqual({ size: 7 });
    expect(seen.patch).toBeUndefined();
    expect(seen.userId).toBe(onServer ? "u" : undefined);
  });

  it("gives prepare the caller's raw patch on update, and beforeWrite every record", async () => {
    seed({ id: "w1", name: "Bolt", size: 1 });
    await call("update", { id: "w1", patch: { name: "Nut" } }, onServer);
    expect(log.filter((l) => l !== "upsert")).toEqual(["load:w1", "prepare", "beforeWrite"]);
    expect(seen.patch).toEqual({ name: "Nut" });
    expect(seen.all).toEqual([{ id: "w1", name: "Bolt", size: 1 }]);
    expect(stored("w1")).toEqual({ id: "w1", name: "Nut", size: 7 });
  });

  it("writes nothing when beforeWrite refuses", async () => {
    seed({ id: "w1", name: "Bolt", size: 1 });
    await expect(
      call("update", { id: "w1", patch: { name: "refused" } }, onServer)
    ).rejects.toThrow("widget: refused.");
    await expect(
      call("create", { entity: { id: "w2", name: "refused" } }, onServer)
    ).rejects.toThrow("widget: refused.");
    expect(stored("w1")).toEqual({ id: "w1", name: "Bolt", size: 1 });
    expect(stored("w2")).toBeUndefined();
    expect(log).not.toContain("upsert");
  });
});

describe("a versioned CRUD", () => {
  it("takes no async write hook: its compare-and-set re-runs a synchronous prepare", () => {
    expect(() =>
      defineCrudActions<Widget>({
        toolId: "__test.versioned_hooks",
        schema: WidgetSchema as unknown as z.ZodType<Widget>,
        entityName: "widget",
        selectAll: () => [],
        upsert: () => {},
        remove: () => {},
        versioned: true,
        beforeWrite: async () => {},
      })
    ).toThrow("a versioned CRUD takes no load, beforeWrite or readAs hook");
    expect(() =>
      defineCrudActions<Widget>({
        toolId: "__test.versioned_read_as",
        schema: WidgetSchema as unknown as z.ZodType<Widget>,
        entityName: "widget",
        selectAll: () => [],
        upsert: () => {},
        remove: () => {},
        versioned: true,
        readAs: async (w) => w,
      })
    ).toThrow("a versioned CRUD takes no load, beforeWrite or readAs hook");
  });
});

describe.each([
  ["in the tab", false],
  ["over MCP", true],
] as const)("defineCrudActions' readAs and beforeDelete %s", (_where, onServer) => {
  const NS2 = "__test.listed";
  const KIND2 = "__test:listed";
  const IDS2 = ["create", "list", "update", "delete"].map((v) => `${NS2}.${v}`);
  let rows: Widget[] = [];
  const steps: string[] = [];
  const call2 = async <T>(verb: string, params: unknown) => {
    const a = registry.get(`${NS2}.${verb}`)!;
    const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
    return (await handler(params as never, ctx())) as T;
  };
  const stored = (id: string) =>
    onServer
      ? (server.rows.get(`${KIND2}/${id}`) as Widget | undefined)
      : rows.find((w) => w.id === id);

  beforeEach(() => {
    rows = [];
    steps.length = 0;
    defineCrudActions<Widget>({
      toolId: NS2,
      serverKind: KIND2,
      schema: WidgetSchema as unknown as z.ZodType<Widget>,
      entityName: "widget",
      selectAll: () => rows,
      upsert: (w) => {
        rows = [...rows.filter((x) => x.id !== w.id), w];
      },
      remove: (id) => {
        steps.push(`remove:${id}`);
        rows = rows.filter((x) => x.id !== id);
      },
      // What the tool lists for a stored row: a size it folds in when unset.
      readAs: async (w, env) => {
        steps.push(`readAs:${w.id}:${env.userId ?? "tab"}`);
        return w.size === undefined ? { ...w, size: 9 } : w;
      },
      prepare: (next, current) => {
        steps.push(`prepare:${current?.size}`);
        return next;
      },
      beforeDelete: async (id, env) => {
        steps.push(`beforeDelete:${id}:${env.userId ?? "tab"}`);
        if (id === "pending") throw new Error("pending_move: widget. Nothing was deleted.");
      },
    });
    const seed = (w: Widget) => {
      if (onServer) server.rows.set(`${KIND2}/${w.id}`, { ...w });
      else rows.push({ ...w });
    };
    seed({ id: "w1", name: "Bolt" });
    seed({ id: "pending", name: "Old" });
  });
  afterEach(() => {
    for (const id of IDS2) registry.unregister(id);
  });

  it("merges an update into the record as readAs reads it, and prepare judges against that", async () => {
    await call2("update", { id: "w1", patch: { name: "Nut" } });
    expect(steps).toEqual([`readAs:w1:${onServer ? "u" : "tab"}`, "prepare:9"]);
    expect(stored("w1")).toEqual({ id: "w1", name: "Nut", size: 9 });
    // An unknown id reads nothing.
    steps.length = 0;
    expect(await call2("update", { id: "nope", patch: { name: "x" } })).toEqual({
      updated: false,
    });
    expect(steps).toEqual([]);
  });

  it("refuses a delete when beforeDelete throws; nothing is removed", async () => {
    await expect(call2("delete", { id: "pending" })).rejects.toThrow("pending_move");
    expect(stored("pending")).toEqual({ id: "pending", name: "Old" });
    expect(await call2("delete", { id: "w1" })).toEqual({ deleted: true });
    expect(stored("w1")).toBeUndefined();
    expect(steps.filter((s) => s.startsWith("beforeDelete"))).toEqual([
      `beforeDelete:pending:${onServer ? "u" : "tab"}`,
      `beforeDelete:w1:${onServer ? "u" : "tab"}`,
    ]);
  });
});
