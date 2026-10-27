import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The agent's item writes and links made before Phase 7, on both
 * transports, as the pages' writes do them (lib/prioritization/
 * backlog-links): an item the new code never saved is saved from what its
 * legacy links say it reads (withLegacyLinks), so its first save keeps a
 * value only a row held, and the legacy rows that disagree with it are
 * marked before its stamp (markLegacyDifferences), so their tools still
 * ask which value to keep. Covered: tool.prioritizer.set_order, the method
 * persists (persistMethodRows), tool.value_effort_matrix.set_position and
 * workspace.backlog_item.update.
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
    serverDeleteEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      server.rows.delete(key(kind, id));
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { OLD_BACKLOG_DEFAULTS } from "@/lib/prioritization/defaults";
import { LEGACY_DIFFERS_FIELD, legacyDifferences } from "@/lib/prioritization/methods";
import "@/lib/actions/workspace";
import "@/lib/actions/tools/prioritizer";
import "@/lib/actions/tools/wsjf";
import "@/lib/actions/tools/moscow";
import "@/lib/actions/tools/value-effort-matrix";

const ctx = () => ({ userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] });
/** Run a verb the way the transport does: params parsed first. */
const run = async <T>(id: string, params: unknown, onServer: boolean) => {
  const a = registry.get(id)!;
  const parsed = a.paramsSchema.safeParse(params);
  if (!parsed.success) throw new Error(`rejected: ${parsed.error.message}`);
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(parsed.data as never, ctx())) as T;
};

const ITEMS = "workspace:backlogItem";
const ROWS = "workspace:prioritization";
const STAMP = "2026-10-20T09:00:00.000Z";

/** A pre-Phase 7 item: every field at its old default, never saved by the new code. */
const legacy = (patch: Partial<BacklogItem> = {}): BacklogItem =>
  ({ ...OLD_BACKLOG_DEFAULTS, id: "b1", name: "Checkout", ...patch }) as BacklogItem;

const row = (
  id: string,
  framework: PrioritizationItem["framework"],
  fields: PrioritizationItem["fields"]
): PrioritizationItem => ({
  id,
  framework,
  title: "Checkout",
  fields,
  status: "scored",
  updatedAt: STAMP,
  backlogItemId: "b1",
});

/** A MoSCoW row the old tool moved to Could while its item kept a real Must. */
const could = row("m2", "moscow", { bucket: "could" });
/** A RICE row re-scored in the old tool while its item kept the old defaults. */
const rice = row("r1", "rice", { reach: 500, impact: 2, confidence: 50, effort: 2 });
const wsjf = row("w1", "wsjf", { businessValue: 8, timeCriticality: 3, rrOe: 2, jobSize: 1 });
const bucketAsked = [{ key: "bucket", row: "could", item: "must" }];

const seed = (items: BacklogItem[], rows: PrioritizationItem[], onServer: boolean) => {
  if (onServer) {
    for (const i of items) server.rows.set(`${ITEMS}/${i.id}`, structuredClone(i));
    for (const r of rows) server.rows.set(`${ROWS}/${r.id}`, structuredClone(r));
  } else {
    useWorkspaceStore.setState({
      backlogItems: structuredClone(items),
      prioritizations: structuredClone(rows),
    });
  }
};

const storedItem = (id: string, onServer: boolean) =>
  onServer
    ? (server.rows.get(`${ITEMS}/${id}`) as BacklogItem | undefined)
    : (useWorkspaceStore.getState().backlogItems ?? []).find((b) => b.id === id);
const storedRow = (id: string, onServer: boolean) =>
  onServer
    ? (server.rows.get(`${ROWS}/${id}`) as PrioritizationItem | undefined)
    : (useWorkspaceStore.getState().prioritizations ?? []).find((p) => p.id === id);

/** The RICE values the legacy row held, now on the item. */
const RICE_KEPT = { reach: 500, impact: 2, confidence: 50, effort: 2 };

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe.each([
  ["in the tab", false],
  ["over MCP", true],
] as const)("an agent's first save of a legacy-linked item %s", (_where, onServer) => {
  /** The item asks about the bucket still, and the row isn't changed otherwise. */
  const expectBucketStillAsked = () => {
    const item = storedItem("b1", onServer)!;
    const m2 = storedRow("m2", onServer)!;
    expect(item.updatedAt).toBeTruthy();
    expect(m2.fields).toEqual({ bucket: "could", [LEGACY_DIFFERS_FIELD]: "bucket" });
    expect(legacyDifferences(m2, item)).toEqual(bucketAsked);
  };

  it("set_order saves the rank from what the legacy rows hold", async () => {
    seed([legacy()], [row("m1", "moscow", { bucket: "must" }), wsjf], onServer);
    await run("tool.prioritizer.set_order", { ids: ["b1"] }, onServer);
    const item = storedItem("b1", onServer)!;
    expect(item).toMatchObject({
      rank: 1,
      moscow: "must",
      businessValue: 8,
      timeCriticality: 3,
      riskReduction: 2,
      jobSize: 1,
    });
    expect(item.updatedAt).toBeTruthy();
    // RICE and Value/Effort were the old defaults everywhere: unset.
    for (const key of ["reach", "impact", "confidence", "effort", "value", "matrixEffort"]) {
      expect(item, key).not.toHaveProperty(key);
    }
  });

  it("set_order marks a legacy row that disagrees with the item", async () => {
    seed([legacy({ moscow: "must" })], [could], onServer);
    await run("tool.prioritizer.set_order", { ids: ["b1"] }, onServer);
    expect(storedItem("b1", onServer)).toMatchObject({ rank: 1, moscow: "must" });
    expectBucketStillAsked();
  });

  it("a method persist keeps the other methods' legacy values and marks the rows that disagree", async () => {
    seed([legacy({ moscow: "must" })], [could, rice], onServer);
    const r = await run<{ id: string; score: number; backlogUpdated: string[] }>(
      "tool.wsjf.score_and_persist",
      {
        title: "Checkout",
        fields: { businessValue: 8, timeCriticality: 3, rrOe: 2, jobSize: 1 },
        backlogItemId: "b1",
      },
      onServer
    );
    expect(r.score).toBe(13);
    expect(storedItem("b1", onServer)).toMatchObject({
      moscow: "must",
      businessValue: 8,
      timeCriticality: 3,
      riskReduction: 2,
      jobSize: 1,
      ...RICE_KEPT,
    });
    expectBucketStillAsked();
    // The row the persist wrote carries no mark; the RICE row agreed.
    expect(storedRow(r.id, onServer)?.fields).not.toHaveProperty(LEGACY_DIFFERS_FIELD);
    expect(storedRow("r1", onServer)).toEqual(rice);
  });

  it("a persist of the row that disagrees answers it: no mark on it", async () => {
    const wont = { ...row("m3", "moscow", { bucket: "wont" }) };
    seed([legacy({ moscow: "must" })], [could, wont], onServer);
    await run(
      "tool.moscow.persist_to_prioritization",
      {
        items: [
          { id: "m2", title: "Checkout", fields: { category: "could" } },
          { id: "m3", title: "Checkout", fields: { category: "wont" } },
        ],
      },
      onServer
    );
    // Both rows were saved by the persist itself: neither keeps a mark,
    // though the first one's write stamped the item.
    expect(storedItem("b1", onServer)?.moscow).toBe("wont");
    expect(storedRow("m2", onServer)?.fields).toEqual({ bucket: "could" });
    expect(storedRow("m3", onServer)?.fields).toEqual({ bucket: "wont" });
  });

  it("set_position un-places from what the legacy rows hold and marks the rows that disagree", async () => {
    const ve = row("v1", "value-effort", { businessValue: 13, effort: 2 });
    seed([legacy({ moscow: "must" })], [could, rice, ve], onServer);
    const r = await run<{ placed: boolean; backlogUpdated: string[] }>(
      "tool.value_effort_matrix.set_position",
      { id: "v1", value: null, effort: null },
      onServer
    );
    expect(r.placed).toBe(false);
    const item = storedItem("b1", onServer)!;
    expect(item).toMatchObject({ moscow: "must", businessValue: 13, ...RICE_KEPT });
    expect(item).not.toHaveProperty("matrixEffort");
    expectBucketStillAsked();
    expect(storedRow("v1", onServer)?.fields).toEqual({ businessValue: 13 });
  });

  it("workspace.backlog_item.update saves from what the legacy rows hold and marks the rows that disagree", async () => {
    seed([legacy({ moscow: "must" })], [could, rice], onServer);
    await run(
      "workspace.backlog_item.update",
      { id: "b1", patch: { name: "Checkout v2" } },
      onServer
    );
    expect(storedItem("b1", onServer)).toMatchObject({
      name: "Checkout v2",
      moscow: "must",
      ...RICE_KEPT,
    });
    expectBucketStillAsked();
  });

  it("writes no mark for an item already saved by the new code", async () => {
    seed([{ id: "b1", name: "Checkout", moscow: "must", updatedAt: STAMP }], [could], onServer);
    await run("tool.prioritizer.set_order", { ids: ["b1"] }, onServer);
    await run("workspace.backlog_item.update", { id: "b1", patch: { name: "Pay" } }, onServer);
    expect(storedRow("m2", onServer)).toEqual(could);
  });
});
