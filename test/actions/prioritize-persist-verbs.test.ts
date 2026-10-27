/**
 * The Prioritize & decide persist verbs on an existing row: an optional
 * input the call leaves out keeps what the row shows (a linked row's from
 * its backlog item), as the page's editor prefills it and saveMethodRow
 * merges an edit, and `null` clears one. "An existing id keeps its other
 * fields", as each verb says.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

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
import "@/lib/actions/tools/rice-scoring";
import "@/lib/actions/tools/moscow";
import "@/lib/actions/tools/cost-of-delay";
import "@/lib/actions/tools/eisenhower";

const ctx = () => ({ userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] });
/** Run a verb the way the transport does: params parsed first. */
const run = async <T>(id: string, params: unknown, onServer = false) => {
  const a = registry.get(id)!;
  const parsed = a.paramsSchema.safeParse(params);
  if (!parsed.success) throw new Error(`rejected: ${parsed.error.message}`);
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(parsed.data as never, ctx())) as T;
};

const STAMP = "2026-10-20T09:00:00.000Z";
const state = () => useWorkspaceStore.getState();
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const storedRow = (id: string) => (state().prioritizations ?? []).find((p) => p.id === id);
const row = (
  id: string,
  framework: PrioritizationItem["framework"],
  fields: PrioritizationItem["fields"],
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({ id, framework, title: id, fields, updatedAt: STAMP, ...extra });

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("tool.rice_scoring persists keep the reach period they aren't given", () => {
  const onboarding: BacklogItem = {
    id: "b1",
    name: "Onboarding",
    reach: 2000,
    reachPeriod: "month",
    impact: 1,
    confidence: 80,
    effort: 2,
    updatedAt: STAMP,
  };
  const rescore = { reach: 2000, impact: 1, confidencePct: 50, effort: 2 };

  it("a linked row keeps its item's period, so a confidence change doesn't triple the divisor", async () => {
    useWorkspaceStore.setState({
      backlogItems: [onboarding],
      prioritizations: [row("r1", "rice", {}, { backlogItemId: "b1" })],
    });
    const r = await run<{ score: number; backlogUpdated: string[] }>(
      "tool.rice_scoring.score_and_persist",
      { id: "r1", title: "Onboarding", fields: rescore }
    );
    // 2000 a month is 6000 a quarter: 6000 × 1 × 50% ÷ 2.
    expect(r.score).toBe(1500);
    expect(r.backlogUpdated).toEqual(["confidence"]);
    expect(storedItem("b1")).toMatchObject({ reachPeriod: "month", confidence: 50 });
  });

  it("a new row linked to an item takes the item's period, on the server too", async () => {
    server.rows.set("workspace:backlogItem/b1", onboarding);
    const r = await run<{ scores: { score: number }[] }>(
      "tool.rice_scoring.persist_to_prioritization",
      { items: [{ title: "Onboarding", fields: rescore, backlogItemId: "b1" }] },
      true
    );
    expect(r.scores[0].score).toBe(1500);
    expect(server.rows.get("workspace:backlogItem/b1")).toMatchObject({ reachPeriod: "month" });
  });

  it("an unlinked row keeps its own period; a new one counts per quarter", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("r2", "rice", {
          reach: 400,
          reachPeriod: "year",
          impact: 1,
          confidence: 80,
          effort: 1,
        }),
      ],
    });
    await run("tool.rice_scoring.persist_to_prioritization", {
      items: [
        {
          id: "r2",
          title: "Yearly",
          fields: { reach: 400, impact: 2, confidencePct: 80, effort: 1 },
        },
        { id: "r3", title: "New", fields: { reach: 400, impact: 2, confidencePct: 80, effort: 1 } },
      ],
    });
    expect(storedRow("r2")?.fields?.reachPeriod).toBe("year");
    // 400 a year is 100 a quarter: 100 × 2 × 80% ÷ 1.
    expect(storedRow("r2")?.score).toBe(160);
    expect(storedRow("r3")?.score).toBe(640);
  });
});

describe("persist verbs keep the optional inputs a call leaves out", () => {
  it("MoSCoW keeps a row's effort when it is moved, and null clears it", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("m1", "moscow", { bucket: "should", effort: 5 }),
        row("m2", "moscow", { bucket: "could", effort: 3 }),
        row("m3", "moscow", { bucket: "should", effort: 2 }),
      ],
    });
    await run("tool.moscow.classify_and_persist", {
      id: "m1",
      title: "m1",
      fields: { category: "must" },
    });
    expect(storedRow("m1")?.fields).toEqual({ bucket: "must", effort: 5 });
    const listed = await run<{ budget: { unsizedMusts: number; share: number | null } }>(
      "tool.moscow.list_items",
      {}
    );
    expect(listed.budget.unsizedMusts).toBe(0);
    expect(listed.budget.share).toBe(0.5);
    await run("tool.moscow.persist_to_prioritization", {
      items: [{ id: "m1", title: "m1", fields: { category: "must", effort: null } }],
    });
    expect(storedRow("m1")?.fields).toEqual({ bucket: "must" });
  });

  it("Cost of Delay keeps a fixed-date row's duration, profile and date, and null clears one", async () => {
    const fields = {
      perWeekUsd: 5000,
      durationWeeks: 2,
      urgency: "fixed_date",
      fixedDate: "2026-12-01",
    };
    server.rows.set("workspace:prioritization/c1", row("c1", "cost-of-delay", fields));
    const r = await run<{ score: number | null; lane: string | null }>(
      "tool.cost_of_delay.score_and_persist",
      { id: "c1", title: "Launch", fields: { perWeekUsd: 6000 } },
      true
    );
    expect(r).toMatchObject({ score: 3000, lane: "fixed_date" });
    expect((server.rows.get("workspace:prioritization/c1") as PrioritizationItem).fields).toEqual({
      ...fields,
      perWeekUsd: 6000,
    });
    const cleared = await run<{ scores: { score: number | null }[] }>(
      "tool.cost_of_delay.persist_to_prioritization",
      { items: [{ id: "c1", title: "Launch", fields: { perWeekUsd: 6000, durationWeeks: null } }] },
      true
    );
    expect(cleared.scores[0].score).toBeNull();
    const after = (server.rows.get("workspace:prioritization/c1") as PrioritizationItem).fields;
    expect(after?.durationWeeks).toBeUndefined();
    expect(after).toMatchObject({ urgency: "fixed_date", fixedDate: "2026-12-01" });
  });

  it("Eisenhower keeps a task's due date and delegate, and its answers in a batch", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("e1", "eisenhower", {
          urgent: "false",
          important: "true",
          dueAt: "2026-12-01",
          delegateTo: "Ana",
        }),
      ],
    });
    await run("tool.eisenhower.classify_and_persist", {
      id: "e1",
      title: "Report",
      fields: { urgent: true, important: true },
    });
    expect(storedRow("e1")?.fields).toEqual({
      urgent: "true",
      important: "true",
      dueAt: "2026-12-01",
      delegateTo: "Ana",
    });
    await run("tool.eisenhower.persist_to_prioritization", {
      items: [{ id: "e1", title: "Report", fields: { important: false, delegateTo: null } }],
    });
    expect(storedRow("e1")?.fields).toEqual({
      urgent: "true",
      important: "false",
      dueAt: "2026-12-01",
    });
  });
});
