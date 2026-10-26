import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The method actions on the registry, both transports: persist verbs check
 * the inputs like the form, recompute the score (a caller's score is
 * ignored), keep an existing row's link and write a linked row's inputs
 * through to its backlog item; the new verbs (decide_order, set_order,
 * place_item, update_task) and add_item without defaults.
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
import "@/lib/actions/tools/prioritizer";
import "@/lib/actions/tools/rice-scoring";
import "@/lib/actions/tools/wsjf";
import "@/lib/actions/tools/moscow";
import "@/lib/actions/tools/value-effort-matrix";
import "@/lib/actions/tools/eisenhower";
import "@/lib/actions/tools/cost-of-delay";
import "@/lib/actions/tools/kano-model";
import "@/lib/actions/workspace";

const ctx = () => ({ userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] });
const browser = async <T>(id: string, params: unknown = {}) =>
  (await registry.get(id)!.handler(params as never, ctx())) as T;
const mcp = async <T>(id: string, params: unknown = {}) => {
  const a = registry.get(id)!;
  return (await (a.mcpHandler ?? a.handler)(params as never, ctx())) as T;
};

const STAMP = "2026-10-20T09:00:00.000Z";
const state = () => useWorkspaceStore.getState();
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const storedRow = (id: string) => (state().prioritizations ?? []).find((p) => p.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("persist verbs", () => {
  it("recompute the score and ignore the caller's", async () => {
    const r = await browser<{ scores: { id: string; score: number }[] }>(
      "tool.wsjf.persist_to_prioritization",
      {
        items: [
          {
            id: "w1",
            title: "Fix",
            score: 999,
            fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 },
          },
        ],
      }
    );
    expect(r.scores).toEqual([{ id: "w1", score: 4 }]);
    expect(storedRow("w1")).toMatchObject({ score: 4, status: "scored" });
  });

  it("refuse what the form refuses, writing nothing", async () => {
    await expect(
      browser("tool.rice_scoring.persist_to_prioritization", {
        items: [
          { title: "Fine", fields: { reach: 1, impact: 1, confidencePct: 50, effort: 1 } },
          { title: "Tiny", fields: { reach: 1, impact: 1, confidencePct: 50, effort: 0.25 } },
        ],
      })
    ).rejects.toThrow("“Tiny”: Effort is at least 0.5 person-months.");
    expect(state().prioritizations).toEqual([]);
  });

  it("keep an existing row's link and other fields, and write through to the item", async () => {
    useWorkspaceStore.setState({
      backlogItems: [{ id: "b1", name: "Search", reach: 100, updatedAt: STAMP }],
      prioritizations: [
        {
          id: "r1",
          framework: "rice",
          title: "Search",
          fields: { reach: 100, impact: 1, confidence: 80, effort: 1, note: "keep" },
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    const r = await browser<{ backlogItemId: string; backlogUpdated: string[] }>(
      "tool.rice_scoring.score_and_persist",
      {
        id: "r1",
        title: "Search",
        fields: { reach: 400, reachPeriod: "month", impact: 2, confidencePct: 50, effort: 2 },
      }
    );
    expect(r.backlogItemId).toBe("b1");
    expect(r.backlogUpdated.sort()).toEqual([
      "confidence",
      "effort",
      "impact",
      "reach",
      "reachPeriod",
    ]);
    expect(storedRow("r1")).toMatchObject({
      backlogItemId: "b1",
      fields: { note: "keep", reach: 400 },
    });
    expect(storedItem("b1")).toMatchObject({
      reach: 400,
      reachPeriod: "month",
      impact: 2,
      confidence: 50,
      effort: 2,
    });
  });

  it("link a row with backlogItemId, on the server too, and refuse an unknown item", async () => {
    server.rows.set("workspace:backlogItem/b1", {
      id: "b1",
      name: "SSO",
      updatedAt: STAMP,
    } as BacklogItem);
    await mcp("tool.moscow.classify_and_persist", {
      id: "m1",
      title: "SSO",
      fields: { category: "must" },
      backlogItemId: "b1",
    });
    expect(server.rows.get("workspace:prioritization/m1")).toMatchObject({
      backlogItemId: "b1",
      score: 4,
    });
    expect(server.rows.get("workspace:backlogItem/b1")).toMatchObject({ moscow: "must" });
    await expect(
      mcp("tool.moscow.classify_and_persist", {
        title: "X",
        fields: { category: "must" },
        backlogItemId: "nope",
      })
    ).rejects.toThrow(/No backlog item nope/);
  });

  it("list a linked row with its item's inputs, and a row without a bucket as unsorted", async () => {
    server.rows.set("workspace:backlogItem/b1", {
      id: "b1",
      name: "SSO",
      moscow: "could",
      updatedAt: STAMP,
    } as BacklogItem);
    server.rows.set("workspace:prioritization/m1", {
      id: "m1",
      framework: "moscow",
      title: "SSO",
      fields: { bucket: "must" },
      backlogItemId: "b1",
      updatedAt: STAMP,
    } as PrioritizationItem);
    server.rows.set("workspace:prioritization/m2", {
      id: "m2",
      framework: "moscow",
      title: "Old",
      fields: {},
      updatedAt: STAMP,
    } as PrioritizationItem);
    const r = await mcp<Record<string, { id: string }[]>>("tool.moscow.list_items");
    expect(r.could.map((x) => x.id)).toEqual(["m1"]);
    expect(r.must).toEqual([]);
    expect(r.unsorted.map((x) => x.id)).toEqual(["m2"]);
  });
});

describe("tool.value_effort_matrix.place_item", () => {
  it("moves a row and writes value and effort to its linked item", async () => {
    useWorkspaceStore.setState({
      backlogItems: [{ id: "b1", name: "Dark mode", updatedAt: STAMP }],
      prioritizations: [
        {
          id: "v1",
          framework: "value-effort",
          title: "Dark mode",
          fields: {},
          backlogItemId: "b1",
          updatedAt: STAMP,
        },
      ],
    });
    const r = await browser<{ quadrant: string; score: number }>(
      "tool.value_effort_matrix.place_item",
      {
        id: "v1",
        value: 13,
        effort: 2,
      }
    );
    expect(r).toMatchObject({ quadrant: "quick_wins", score: 6.5 });
    expect(storedItem("b1")).toMatchObject({ businessValue: 13, matrixEffort: 2 });
    expect(storedRow("v1")?.fields).toEqual({ businessValue: 13, effort: 2 });
    await expect(
      browser("tool.value_effort_matrix.place_item", { id: "gone", value: 1, effort: 1 })
    ).rejects.toThrow();
  });
});

describe("tool.eisenhower.update_task", () => {
  it("changes the answers and the due date; the quadrant follows", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          id: "e1",
          framework: "eisenhower",
          title: "Report",
          fields: { quadrant: "schedule" },
          updatedAt: STAMP,
        },
      ],
    });
    const r = await browser<{ quadrant: string }>("tool.eisenhower.update_task", {
      id: "e1",
      important: false,
    });
    expect(r.quadrant).toBe("delete");
    expect(storedRow("e1")?.fields).toEqual({ urgent: "false", important: "false" });
    await expect(
      browser("tool.eisenhower.persist_to_prioritization", {
        items: [{ title: "Clash", quadrant: "do", fields: { urgent: false } }],
      })
    ).rejects.toThrow(/contradicts/);
  });
});

describe("tool.prioritizer", () => {
  const items: BacklogItem[] = [
    {
      id: "a",
      name: "A",
      businessValue: 8,
      timeCriticality: 1,
      riskReduction: 1,
      jobSize: 1,
      reach: 100,
      impact: 1,
      confidence: 100,
      effort: 1,
      updatedAt: STAMP,
    },
    {
      id: "b",
      name: "B",
      businessValue: 3,
      timeCriticality: 1,
      riskReduction: 1,
      jobSize: 1,
      reach: 900,
      impact: 1,
      confidence: 100,
      effort: 1,
      updatedAt: STAMP,
    },
    { id: "c", name: "C", updatedAt: STAMP },
  ];

  it("adds an item with nothing scored it wasn't given", async () => {
    const { id } = await browser<{ id: string }>("tool.prioritizer.add_item", {
      name: "Search",
      reach: 50,
    });
    const stored = storedItem(id)!;
    expect(stored).toMatchObject({ name: "Search", reach: 50 });
    expect(stored.moscow).toBeUndefined();
    expect(stored.jobSize).toBeUndefined();
    expect(stored.updatedAt).toBeTruthy();
  });

  it("decides the order from the per-method ranks, unscored last", async () => {
    useWorkspaceStore.setState({ backlogItems: items });
    const r = await browser<{
      methods: string[];
      consensus: { id: string; borda: number | null; coverage: number; disagree: boolean }[];
      suggestedOrder: string[];
      unscored: string[];
      skipped: { method: string }[];
    }>("tool.prioritizer.decide_order");
    expect(r.methods).toEqual(["wsjf", "rice"]);
    expect(r.consensus.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(r.consensus[0]).toMatchObject({ borda: 50, coverage: 2, disagree: true });
    expect(r.suggestedOrder).toEqual(["a", "b"]);
    expect(r.unscored).toEqual(["c"]);
    expect(r.skipped.map((s) => s.method)).toContain("moscow");
  });

  it("saves an order, unranking the rest, and refuses unknown ids", async () => {
    const ranked: BacklogItem = { ...items[0], rank: 3 };
    server.rows.set("workspace:backlogItem/a", ranked);
    server.rows.set("workspace:backlogItem/b", items[1]);
    server.rows.set("workspace:backlogItem/c", items[2]);
    const r = await mcp<{ ranked: number; unranked: number; changed: number }>(
      "tool.prioritizer.set_order",
      {
        ids: ["b", "c"],
      }
    );
    expect(r).toEqual({ ranked: 2, unranked: 1, changed: 3 });
    expect((server.rows.get("workspace:backlogItem/b") as BacklogItem).rank).toBe(1);
    expect((server.rows.get("workspace:backlogItem/c") as BacklogItem).rank).toBe(2);
    expect((server.rows.get("workspace:backlogItem/a") as BacklogItem).rank).toBeUndefined();
    await expect(mcp("tool.prioritizer.set_order", { ids: ["zz"] })).rejects.toThrow(
      /Unknown backlog item ids: zz/
    );

    const listed = await mcp<{ ordered: { id: string; rank: number | null }[] }>(
      "tool.prioritizer.list_state"
    );
    expect(listed.ordered.map((i) => [i.id, i.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", null],
    ]);
  });
});

describe("workspace.backlog_item.delete", () => {
  const b1: BacklogItem = {
    id: "b1",
    name: "Passkeys",
    businessValue: 13,
    timeCriticality: 8,
    riskReduction: 2,
    jobSize: 3,
    updatedAt: STAMP,
  };
  const linked: PrioritizationItem = {
    id: "w1",
    framework: "wsjf",
    title: "Passkeys",
    fields: {},
    backlogItemId: "b1",
    updatedAt: STAMP,
  };

  it("freezes and unlinks the item's rows on the server, then deletes it", async () => {
    server.rows.set("workspace:backlogItem/b1", b1);
    server.rows.set("workspace:prioritization/w1", linked);
    await mcp("workspace.backlog_item.delete", { id: "b1" });
    expect(server.rows.has("workspace:backlogItem/b1")).toBe(false);
    const row = server.rows.get("workspace:prioritization/w1") as PrioritizationItem;
    expect(row.backlogItemId).toBeUndefined();
    expect(row.fields).toEqual({ businessValue: 13, timeCriticality: 8, rrOe: 2, jobSize: 3 });
    expect(row.score).toBeCloseTo(23 / 3, 6);
  });

  it("does the same in the browser", async () => {
    useWorkspaceStore.setState({ backlogItems: [b1], prioritizations: [linked] });
    await browser("workspace.backlog_item.delete", { id: "b1" });
    expect(state().backlogItems).toEqual([]);
    expect(storedRow("w1")).toMatchObject({
      fields: { businessValue: 13, timeCriticality: 8, rrOe: 2, jobSize: 3 },
    });
    expect(storedRow("w1")?.backlogItemId).toBeUndefined();
  });
});
