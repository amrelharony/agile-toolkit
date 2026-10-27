/**
 * workspace.backlog_item create and update go through the method engine,
 * on both transports, as the hub's writes do: a create is stamped (so a
 * "should" it sets reads as chosen, as tool.prioritizer.add_item's does),
 * an update applies what changed through applyItemPatch (old-default
 * fingerprints cleared, the legacy value dropped, the item stamped), and
 * what a write sets is checked by the methods' rules first.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogItem } from "@/lib/stores/workspace-types";

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
    serverDeleteEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      server.rows.delete(key(kind, id));
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { readBacklogItem } from "@/lib/prioritization/defaults";
import { evaluateItemIn } from "@/lib/prioritization/methods";
import "@/lib/actions/workspace";
import "@/lib/actions/tools/prioritizer";

const ctx = () => ({ userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] });
/** Run a verb the way the transport does: params parsed first. */
const run = async <T>(id: string, params: unknown, onServer: boolean) => {
  const a = registry.get(id)!;
  const parsed = a.paramsSchema.safeParse(params);
  if (!parsed.success) throw new Error(`rejected: ${parsed.error.message}`);
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(parsed.data as never, ctx())) as T;
};

const KIND = "workspace:backlogItem";
const STAMP = "2026-10-20T09:00:00.000Z";

/** A pre-Phase 7 item: every method at its old Add item default, never stamped. */
const LEGACY: BacklogItem = {
  id: "b_old",
  name: "Old",
  moscow: "should",
  businessValue: 5,
  timeCriticality: 5,
  riskReduction: 5,
  jobSize: 5,
  reach: 100,
  impact: 1,
  confidence: 80,
  effort: 1,
  value: 5,
  matrixEffort: 5,
};

/** The item stored on this transport. */
const stored = (id: string, onServer: boolean) =>
  onServer
    ? (server.rows.get(`${KIND}/${id}`) as BacklogItem | undefined)
    : (useWorkspaceStore.getState().backlogItems ?? []).find((b) => b.id === id);

const seed = (item: BacklogItem, onServer: boolean) => {
  if (onServer) server.rows.set(`${KIND}/${item.id}`, structuredClone(item));
  else useWorkspaceStore.setState({ backlogItems: [structuredClone(item)] });
};

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe.each([
  ["in the tab", false],
  ["over MCP", true],
] as const)("workspace.backlog_item %s", (_where, onServer) => {
  it("stamps a create, so a bucket that was the old default reads as chosen", async () => {
    const { id } = await run<{ id: string }>(
      "workspace.backlog_item.create",
      { entity: { name: "SSO", moscow: "should" } },
      onServer
    );
    const item = stored(id, onServer)!;
    expect(item.updatedAt).toBeTruthy();
    expect(readBacklogItem(item).moscow).toBe("should");
    // The Prioritizer agrees: sorted as Should, not Not sorted yet.
    const state = await run<{ byMoscow: Record<string, number>; notSorted: number }>(
      "tool.prioritizer.list_state",
      {},
      onServer
    );
    expect(state.byMoscow.should).toBe(1);
    expect(state.notSorted).toBe(0);
  });

  it("clears a legacy item's old defaults on update, as the WSJF tool's write does", async () => {
    seed(LEGACY, onServer);
    expect(
      await run(
        "workspace.backlog_item.update",
        { id: LEGACY.id, patch: { timeCriticality: 13 } },
        onServer
      )
    ).toEqual({ updated: true });
    const item = stored(LEGACY.id, onServer)!;
    // Only the part set is a choice: the other three 5s were defaults, so WSJF
    // waits for them (Not scored), never (5 + 13 + 5) / 5.
    expect(item).toMatchObject({ id: LEGACY.id, name: "Old", timeCriticality: 13 });
    for (const key of ["moscow", "businessValue", "riskReduction", "jobSize", "reach"] as const) {
      expect(item[key], key).toBeUndefined();
    }
    expect(item.value).toBeUndefined();
    expect(item.matrixEffort).toBeUndefined();
    expect(item.updatedAt).toBeTruthy();
    expect(evaluateItemIn(item, [], "wsjf").score).toBeNull();
  });

  it("drops the legacy value when businessValue is written", async () => {
    seed({ id: "b1", name: "Search", value: 9, updatedAt: STAMP }, onServer);
    await run("workspace.backlog_item.update", { id: "b1", patch: { businessValue: 8 } }, onServer);
    const item = stored("b1", onServer)!;
    expect(item.businessValue).toBe(8);
    expect(item.value).toBeUndefined();
    expect(item.updatedAt).not.toBe(STAMP);
  });

  it("refuses an input off its method's scale, writing nothing", async () => {
    seed({ id: "b1", name: "Search", businessValue: 8, updatedAt: STAMP }, onServer);
    await expect(
      run("workspace.backlog_item.update", { id: "b1", patch: { businessValue: 7 } }, onServer)
    ).rejects.toThrow("businessValue: Business value is one of 1, 2, 3, 5, 8, 13 or 20.");
    await expect(
      run("workspace.backlog_item.update", { id: "b1", patch: { confidence: 0 } }, onServer)
    ).rejects.toThrow(/confidence: Confidence runs/);
    await expect(
      run("workspace.backlog_item.update", { id: "b1", patch: { matrixEffort: 11 } }, onServer)
    ).rejects.toThrow("matrixEffort: Effort runs from 1 to 10.");
    expect(stored("b1", onServer)).toEqual({
      id: "b1",
      name: "Search",
      businessValue: 8,
      updatedAt: STAMP,
    });
    await expect(
      run("workspace.backlog_item.create", { entity: { name: "X", jobSize: 50 } }, onServer)
    ).rejects.toThrow("jobSize: Job size is one of 1, 2, 3, 5, 8, 13 or 20.");
    await expect(
      run("workspace.backlog_item.create", { entity: { name: "X", value: 7 } }, onServer)
    ).rejects.toThrow(/value: the old 1-10 matrix value is read-only/);
  });

  it("an item echoed back from list with a new name saves: its stored read-only value isn't a write", async () => {
    seed(LEGACY, onServer);
    const echo: Partial<BacklogItem> = { ...LEGACY, name: "Old v2" };
    delete echo.id;
    await run("workspace.backlog_item.update", { id: "b_old", patch: echo }, onServer);
    expect(stored("b_old", onServer)).toMatchObject({ name: "Old v2", businessValue: 5 });
    // A changed value is still refused.
    await expect(
      run("workspace.backlog_item.update", { id: "b_old", patch: { value: 7 } }, onServer)
    ).rejects.toThrow(/value: the old 1-10 matrix value is read-only/);
  });

  it("judges only what a write changes: a rename keeps a held off-scale value", async () => {
    const custom: BacklogItem = { id: "b1", name: "Search", businessValue: 7, updatedAt: STAMP };
    seed(custom, onServer);
    await run("workspace.backlog_item.update", { id: "b1", patch: { name: "Find" } }, onServer);
    expect(stored("b1", onServer)).toMatchObject({ name: "Find", businessValue: 7 });
  });

  it("leaves an item as it is when the update changes nothing", async () => {
    seed(LEGACY, onServer);
    await run("workspace.backlog_item.update", { id: LEGACY.id, patch: { name: "Old" } }, onServer);
    expect(stored(LEGACY.id, onServer)).toEqual(LEGACY);
  });

  // An update judges the patch against what the item reads as, as the
  // hub's saveBacklogItem does: a value the caller sends is a choice, also
  // one equal to a stored old default (which reads as Not scored).
  it("keeps a stored old default the patch sends again: the caller chose it", async () => {
    seed(LEGACY, onServer);
    await run(
      "workspace.backlog_item.update",
      { id: LEGACY.id, patch: { moscow: "should" } },
      onServer
    );
    const item = stored(LEGACY.id, onServer)!;
    expect(item.moscow).toBe("should");
    expect(item.updatedAt).toBeTruthy();
    expect(readBacklogItem(item).moscow).toBe("should");
    // Sent with another change, it stays too.
    seed(LEGACY, onServer);
    await run(
      "workspace.backlog_item.update",
      { id: LEGACY.id, patch: { moscow: "should", name: "Renamed" } },
      onServer
    );
    expect(stored(LEGACY.id, onServer)).toMatchObject({ name: "Renamed", moscow: "should" });
  });

  it("places an old 5/5 item given a value and its old effort", async () => {
    seed(LEGACY, onServer);
    await run(
      "workspace.backlog_item.update",
      { id: LEGACY.id, patch: { businessValue: 8, matrixEffort: 5 } },
      onServer
    );
    const item = stored(LEGACY.id, onServer)!;
    expect(item).toMatchObject({ businessValue: 8, matrixEffort: 5 });
    expect(evaluateItemIn(item, [], "value-effort").bucket).toBe("quick_wins");
  });

  it("scores WSJF when the patch sends all four parts, the old 5s included", async () => {
    seed(LEGACY, onServer);
    await run(
      "workspace.backlog_item.update",
      {
        id: LEGACY.id,
        patch: { businessValue: 5, timeCriticality: 5, riskReduction: 5, jobSize: 5 },
      },
      onServer
    );
    const item = stored(LEGACY.id, onServer)!;
    expect(evaluateItemIn(item, [], "wsjf").score).toBe(3);
    // The methods the patch didn't touch lose their old defaults.
    expect(item).not.toHaveProperty("moscow");
    expect(item).not.toHaveProperty("reach");
  });

  it("refuses a rank another item holds, on create and update, writing nothing", async () => {
    const a: BacklogItem = { id: "a", name: "Search", rank: 1, updatedAt: STAMP };
    const b: BacklogItem = { id: "b", name: "Export", rank: 2, updatedAt: STAMP };
    if (onServer) {
      for (const x of [a, b]) server.rows.set(`${KIND}/${x.id}`, structuredClone(x));
    } else useWorkspaceStore.setState({ backlogItems: [structuredClone(a), structuredClone(b)] });
    await expect(
      run("workspace.backlog_item.update", { id: "b", patch: { rank: 1 } }, onServer)
    ).rejects.toThrow("rank: 1 is already the place of “Search” (a) in the decided order");
    expect(stored("b", onServer)).toEqual(b);
    await expect(
      run("workspace.backlog_item.create", { entity: { name: "New", rank: 2 } }, onServer)
    ).rejects.toThrow(/rank: 2 is already the place of “Export” \(b\).*set_order/);
    const all = onServer
      ? Array.from(server.rows.keys()).filter((k) => k.startsWith(`${KIND}/`))
      : (useWorkspaceStore.getState().backlogItems ?? []);
    expect(all).toHaveLength(2);
    // Its own rank sent again, or a free one, saves.
    await run(
      "workspace.backlog_item.update",
      { id: "a", patch: { rank: 1, name: "Find" } },
      onServer
    );
    expect(stored("a", onServer)).toMatchObject({ name: "Find", rank: 1 });
    await run("workspace.backlog_item.update", { id: "b", patch: { rank: 3 } }, onServer);
    expect(stored("b", onServer)?.rank).toBe(3);
  });
});
