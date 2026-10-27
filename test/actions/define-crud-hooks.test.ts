import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * defineCrudActions' write hooks, on both transports: `load` reads what a
 * write needs before `prepare`, `prepare` gets the caller's raw patch on
 * update, and `beforeWrite` runs last, may refuse (nothing is written) and
 * sees every record of the entity on its transport. A versioned CRUD
 * (a synchronous compare-and-set) takes neither async hook.
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
    ).toThrow("a versioned CRUD takes no load or beforeWrite hook");
  });
});
