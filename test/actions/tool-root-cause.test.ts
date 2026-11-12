/**
 * tool.root_cause.* action coverage.
 *
 *   1. registration: list_state reads; add_why, add_cause and set_outcome
 *      write without a confirmation, each with an MCP handler, and none is
 *      kept from visitors (it's the visitor's own data)
 *   2. list_state: every analysis with its stage, whys, Pareto order and
 *      the page's verdict, newest change first, and a malformed row read
 *      safely
 *   3. add_why / add_cause: appended within the caps, stamped, refused for
 *      an unknown analysis or a full list
 *   4. set_outcome: sets and clears the root cause and the countermeasure,
 *      leaving out what isn't passed
 *   5. the MCP path reads and writes the user's rows
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ROOT_CAUSE_ANALYSIS_KIND,
  TOOL_LIST_MAX,
  type RootCauseAnalysis,
} from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/root-cause";

const ctx = () => ({
  userId: "test-user",
  source: "agent" as const,
  squadProfileIds: [] as string[],
});
const ws = () => useWorkspaceStore.getState();
const run = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.handler(params, ctx())) as T;
const runMcp = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.mcpHandler!(params, ctx())) as T;

function analysis(
  over: Partial<RootCauseAnalysis> & Pick<RootCauseAnalysis, "id">
): RootCauseAnalysis {
  return {
    title: "Releases rolled back",
    problem: "Two of three releases rolled back.",
    method: "five-whys",
    whys: [],
    causes: [],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...over,
  };
}

const stored = (id: string) => (ws().rootCauseAnalyses ?? []).find((a) => a.id === id);

beforeEach(() => {
  useWorkspaceStore.setState({ rootCauseAnalyses: [] });
  vi.mocked(serverStore.serverGetEntity).mockReset().mockResolvedValue(null);
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
  vi.mocked(serverStore.serverUpsertEntity)
    .mockReset()
    .mockResolvedValue(undefined as never);
});

describe("tool.root_cause: registration", () => {
  it("reads with list_state and writes with add_why, add_cause and set_outcome", () => {
    expect(registry.get("tool.root_cause.list_state")?.category).toBe("read");
    for (const name of ["add_why", "add_cause", "set_outcome"]) {
      const action = registry.get(`tool.root_cause.${name}`);
      expect(action?.category).toBe("write");
      expect(action?.requiresConfirmation).toBe(false);
      expect(action?.mcpHandler).toBeTypeOf("function");
      // The visitor's own data: nothing reaches other people.
      expect(action?.visitor).not.toBe(false);
    }
  });
});

describe("tool.root_cause.list_state", () => {
  it("is empty with no analysis", async () => {
    const r = await run<{ total: number; verdict: string; analyses: unknown[] }>(
      "tool.root_cause.list_state"
    );
    expect(r).toMatchObject({ total: 0, verdict: "No analysis yet.", analyses: [] });
  });

  it("lists analyses newest first, with stage, whys and the Pareto order", async () => {
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_old",
        whys: [{ id: "w1", text: "A migration failed." }],
        rootCause: "Staging data is tiny.",
        updatedAt: "2026-11-02T09:00:00.000Z",
      })
    );
    ws().upsertRootCauseAnalysis(
      analysis({
        id: "rca_new",
        title: "Checkout errors noticed late",
        method: "fishbone",
        causes: [
          { id: "c1", category: "Measurement", text: "No alert", count: 6 },
          { id: "c2", category: "Process", text: "Tickets once a day", count: 3 },
          { id: "c3", category: "Tools", text: "Split logs", count: 1 },
        ],
        updatedAt: "2026-11-05T09:00:00.000Z",
        sentTo: [{ route: "retro-action", targetId: "card-9", at: "2026-11-05T09:00:00.000Z" }],
        countermeasure: "Alert on the error rate.",
      })
    );
    const r = await run<{
      total: number;
      byStage: Record<string, number>;
      verdict: string;
      analyses: {
        id: string;
        stage: string;
        whys: { text: string }[];
        pareto: { id: string; cumulativePct: number; vital: boolean }[];
        sentToRetroActions: boolean;
        rootCause: string | null;
      }[];
    }>("tool.root_cause.list_state");
    expect(r.total).toBe(2);
    expect(r.analyses.map((a) => a.id)).toEqual(["rca_new", "rca_old"]);
    expect(r.byStage).toEqual({ started: 0, "root-cause": 1, countermeasure: 0, sent: 1 });
    expect(r.verdict).toContain("root cause but no countermeasure");
    const [fresh, old] = r.analyses;
    expect(fresh.stage).toBe("sent");
    expect(fresh.sentToRetroActions).toBe(true);
    expect(fresh.pareto.map((p) => p.id)).toEqual(["c1", "c2", "c3"]);
    expect(fresh.pareto[0]).toMatchObject({ cumulativePct: 60, vital: true });
    expect(fresh.pareto[2].vital).toBe(false);
    expect(old).toMatchObject({ stage: "root-cause", rootCause: "Staging data is tiny." });
    expect(old.whys.map((w) => w.text)).toEqual(["A migration failed."]);
  });

  it("reads a malformed row safely and drops what isn't an analysis", async () => {
    useWorkspaceStore.setState({
      rootCauseAnalyses: [
        {
          id: "rca_odd",
          title: "",
          method: "guesswork",
          whys: [{ id: "w1", text: "  " }, null, { id: "w2", text: "Real" }],
          causes: [{ id: "c1", text: "No alert", count: -4, category: "" }],
        } as unknown as RootCauseAnalysis,
        { title: "no id" } as unknown as RootCauseAnalysis,
      ],
    });
    const r = await run<{
      total: number;
      analyses: { title: string; method: string; whys: { text: string }[]; causeCount: number }[];
    }>("tool.root_cause.list_state");
    expect(r.total).toBe(1);
    expect(r.analyses[0]).toMatchObject({
      title: "Untitled problem",
      method: "five-whys",
      causeCount: 1,
    });
    expect(r.analyses[0].whys.map((w) => w.text)).toEqual(["Real"]);
  });
});

describe("tool.root_cause.add_why", () => {
  it("appends the next why, stamped", async () => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1", whys: [{ id: "w1", text: "First." }] }));
    const r = await run<{ added: boolean; whyId: string; count: number }>(
      "tool.root_cause.add_why",
      { analysisId: "rca_1", text: "  The migration never ran on real data.  " }
    );
    expect(r).toMatchObject({ added: true, count: 2 });
    const a = stored("rca_1")!;
    expect(a.whys.map((w) => w.text)).toEqual(["First.", "The migration never ran on real data."]);
    expect(a.whys[1].id).toBe(r.whyId);
    expect(a.updatedAt > "2026-11-01T09:00:00.000Z").toBe(true);
  });

  it("refuses an unknown analysis and a full chain", async () => {
    expect(await run("tool.root_cause.add_why", { analysisId: "rca_nope", text: "x" })).toEqual({
      added: false,
      reason: "not_found",
    });
    const whys = Array.from({ length: TOOL_LIST_MAX.whys }, (_, i) => ({
      id: `w${i}`,
      text: `Why ${i}`,
    }));
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_full", whys }));
    expect(
      await run("tool.root_cause.add_why", { analysisId: "rca_full", text: "One more" })
    ).toEqual({ added: false, reason: "chain_full" });
    expect(stored("rca_full")!.whys).toHaveLength(TOOL_LIST_MAX.whys);
  });

  it("refuses blank or over-long text at the schema", () => {
    const schema = registry.get("tool.root_cause.add_why")!.paramsSchema;
    expect(schema.safeParse({ analysisId: "rca_1", text: "   " }).success).toBe(false);
    expect(schema.safeParse({ analysisId: "rca_1", text: "x".repeat(1001) }).success).toBe(false);
  });
});

describe("tool.root_cause.add_cause", () => {
  it("adds a cause under its category, counting 1 by default", async () => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1", method: "fishbone" }));
    const r = await run<{ added: boolean; causeId: string; count: number }>(
      "tool.root_cause.add_cause",
      { analysisId: "rca_1", category: "Measurement", text: "No alert on errors" }
    );
    expect(r).toMatchObject({ added: true, count: 1 });
    await run("tool.root_cause.add_cause", {
      analysisId: "rca_1",
      category: "Suppliers",
      text: "The provider changed its codes",
      count: 4,
    });
    expect(stored("rca_1")!.causes).toEqual([
      { id: r.causeId, category: "Measurement", text: "No alert on errors", count: 1 },
      expect.objectContaining({ category: "Suppliers", count: 4 }),
    ]);
  });

  it("refuses an unknown analysis, a full fishbone and a bad count", async () => {
    expect(
      await run("tool.root_cause.add_cause", { analysisId: "x", category: "People", text: "y" })
    ).toEqual({ added: false, reason: "not_found" });
    const causes = Array.from({ length: TOOL_LIST_MAX.causes }, (_, i) => ({
      id: `c${i}`,
      category: "Other",
      text: `Cause ${i}`,
      count: 1,
    }));
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_full", causes }));
    expect(
      await run("tool.root_cause.add_cause", {
        analysisId: "rca_full",
        category: "People",
        text: "One more",
      })
    ).toEqual({ added: false, reason: "fishbone_full" });
    const schema = registry.get("tool.root_cause.add_cause")!.paramsSchema;
    expect(
      schema.safeParse({ analysisId: "a", category: "People", text: "x", count: 1.5 }).success
    ).toBe(false);
    expect(schema.safeParse({ analysisId: "a", category: "", text: "x" }).success).toBe(false);
  });
});

describe("tool.root_cause.set_outcome", () => {
  it("sets the root cause and countermeasure, and clears with null or blank", async () => {
    ws().upsertRootCauseAnalysis(analysis({ id: "rca_1" }));
    expect(
      await run("tool.root_cause.set_outcome", {
        analysisId: "rca_1",
        rootCause: "Nobody owns staging data.",
      })
    ).toEqual({ updated: true, stage: "root-cause" });
    expect(
      await run("tool.root_cause.set_outcome", {
        analysisId: "rca_1",
        countermeasure: "Name an owner.\nCheck: no rollback in three releases.",
      })
    ).toEqual({ updated: true, stage: "countermeasure" });
    expect(stored("rca_1")).toMatchObject({
      rootCause: "Nobody owns staging data.",
      countermeasure: "Name an owner.\nCheck: no rollback in three releases.",
    });
    await run("tool.root_cause.set_outcome", { analysisId: "rca_1", countermeasure: null });
    await run("tool.root_cause.set_outcome", { analysisId: "rca_1", rootCause: "  " });
    expect(stored("rca_1")!.countermeasure).toBeUndefined();
    expect(stored("rca_1")!.rootCause).toBeUndefined();
  });

  it("refuses an unknown analysis", async () => {
    expect(
      await run("tool.root_cause.set_outcome", { analysisId: "nope", rootCause: "x" })
    ).toEqual({ updated: false, reason: "not_found" });
  });
});

describe("tool.root_cause: the MCP path", () => {
  it("lists the user's rows and writes a why back to them", async () => {
    const row = analysis({ id: "rca_srv", whys: [{ id: "w1", text: "First." }] });
    vi.mocked(serverStore.serverListEntities).mockResolvedValue([row] as never);
    vi.mocked(serverStore.serverGetEntity).mockResolvedValue(row as never);
    const listed = await runMcp<{ total: number }>("tool.root_cause.list_state");
    expect(listed.total).toBe(1);
    expect(serverStore.serverListEntities).toHaveBeenCalledWith(
      "test-user",
      ROOT_CAUSE_ANALYSIS_KIND
    );
    const r = await runMcp<{ added: boolean; count: number }>("tool.root_cause.add_why", {
      analysisId: "rca_srv",
      text: "Second.",
    });
    expect(r).toMatchObject({ added: true, count: 2 });
    const [, kind, saved] = vi.mocked(serverStore.serverUpsertEntity).mock.calls[0] as unknown as [
      string,
      string,
      RootCauseAnalysis,
    ];
    expect(kind).toBe(ROOT_CAUSE_ANALYSIS_KIND);
    expect(saved.whys.map((w) => w.text)).toEqual(["First.", "Second."]);
    // The browser's store is untouched on the MCP path.
    expect(ws().rootCauseAnalyses).toEqual([]);
  });
});
