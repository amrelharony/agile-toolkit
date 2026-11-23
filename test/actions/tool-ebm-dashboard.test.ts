/**
 * tool.ebm_dashboard.* — Amr's EBM verbs read the same areas, ladder and
 * reviews the page shows, write measures and readings into the shared
 * product metrics, and the MCP path does the same against the server store.
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

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  EBM_BOARD_ID,
  EBM_BOARD_KIND,
  PRODUCT_METRIC_KIND,
  type EbmBoard,
  type ProductMetric,
  type TechDebtItem,
} from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import "@/lib/actions/tools/ebm-dashboard";
import { buildEbmExample } from "@/app/(tools)/ebm-dashboard/example";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const mcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};

const NOW = "2026-11-01T00:00:00.000Z";
const metrics = () => useWorkspaceStore.getState().productMetrics ?? [];
const board = () => (useWorkspaceStore.getState().ebmBoards ?? [])[0] as EbmBoard | undefined;
const debt = (id: string): TechDebtItem => ({ id, title: id, impact: 3 }) as TechDebtItem;

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({
    productMetrics: [],
    ebmBoards: [],
    productGoals: [],
    sprints: [],
    hypothesisTrackers: [],
    techDebt: [],
    stories: [],
    kanbanBoards: [],
    doraScorecards: [],
    npsResponses: [],
  });
});

describe("registration", () => {
  it("has three reads and four writes, each write with a server handler, all for visitors", () => {
    for (const id of ["list_state", "read_sources", "suggest_focus"]) {
      expect(registry.get(`tool.ebm_dashboard.${id}`)?.category).toBe("read");
    }
    for (const id of [
      "add_measure",
      "accept_source_reading",
      "set_strategic_goal",
      "record_review",
    ]) {
      const a = registry.get(`tool.ebm_dashboard.${id}`);
      expect(a?.category).toBe("write");
      expect(a?.mcpHandler).toBeTypeOf("function");
      expect(a?.visitor).not.toBe(false);
    }
  });
});

describe("list_state", () => {
  it("reads each area's measures and progress, the weakest area and the last review", async () => {
    const ex = buildEbmExample(todayLocalISO(), NOW);
    useWorkspaceStore.setState({
      productMetrics: ex.metrics,
      ebmBoards: [{ id: EBM_BOARD_ID, reviews: ex.reviews, createdAt: NOW, updatedAt: NOW }],
    });
    const r = await run<{
      areas: { area: string; progress: number | null; measures: { example: boolean }[] }[];
      weakestArea: string;
      lastReview: { id: string };
      exampleLoaded: boolean;
      ladder: { strategic: unknown };
    }>("tool.ebm_dashboard.list_state");
    expect(r.areas.map((a) => a.measures.length)).toEqual([2, 2, 2, 2]);
    expect(r.areas.every((a) => a.progress !== null)).toBe(true);
    expect(r.areas[0].measures[0].example).toBe(true);
    expect(r.weakestArea).toBeTruthy();
    expect(r.lastReview.id).toBe("example-ebm-review-2");
    expect(r.exampleLoaded).toBe(true);
    expect(r.ladder.strategic).toBeNull();
  });
});

describe("add_measure", () => {
  it("adds a new measure in an area, or tags an existing metric", async () => {
    const r = await run<{ added: boolean; metricId: string; created: boolean }>(
      "tool.ebm_dashboard.add_measure",
      {
        area: "time-to-market",
        name: "Median cycle time",
        direction: "decrease",
        unit: "days",
        source: "cycle-time-median",
      }
    );
    expect(r).toMatchObject({ added: true, created: true });
    expect(metrics()[0]).toMatchObject({
      kva: "time-to-market",
      source: "cycle-time-median",
      readings: [],
    });
    useWorkspaceStore.setState({
      productMetrics: [
        ...metrics(),
        {
          id: "metric_ns",
          name: "NS",
          direction: "increase",
          role: "north-star",
          readings: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    const tag = await run("tool.ebm_dashboard.add_measure", {
      area: "current-value",
      metricId: "metric_ns",
    });
    expect(tag).toEqual({ added: true, metricId: "metric_ns", created: false });
    expect(metrics().find((m) => m.id === "metric_ns")).toMatchObject({
      kva: "current-value",
      role: "north-star",
    });
    expect(
      await run("tool.ebm_dashboard.add_measure", { area: "current-value", metricId: "nope" })
    ).toEqual({
      added: false,
      reason: "not_found",
    });
  });

  it("refuses a target on the wrong side of the baseline, and needs a name or an id", async () => {
    await expect(
      run("tool.ebm_dashboard.add_measure", {
        area: "current-value",
        name: "NPS",
        direction: "increase",
        baseline: 30,
        target: 20,
      })
    ).rejects.toThrow(/above the baseline/);
    expect(() =>
      registry.get("tool.ebm_dashboard.add_measure")!.paramsSchema.parse({ area: "current-value" })
    ).toThrow();
  });

  it("writes on the server", async () => {
    await mcp("tool.ebm_dashboard.add_measure", {
      area: "unrealized-value",
      name: "Gap",
      direction: "decrease",
    });
    const stored = Array.from(rows.entries()).filter(([k]) =>
      k.startsWith(`${PRODUCT_METRIC_KIND}/`)
    );
    expect(stored).toHaveLength(1);
    expect((stored[0][1] as ProductMetric).kva).toBe("unrealized-value");
  });
});

describe("read_sources and accept_source_reading", () => {
  it("reads the toolkit's numbers and writes one as a reading only when asked", async () => {
    useWorkspaceStore.setState({
      techDebt: [debt("d1"), debt("d2")],
      productMetrics: [
        {
          id: "metric_debt",
          name: "Open tech debt",
          direction: "decrease",
          kva: "ability-to-innovate",
          source: "open-tech-debt",
          readings: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    const r = await run<{
      sources: { id: string; reading: { value: number } | null; measures: string[] }[];
    }>("tool.ebm_dashboard.read_sources");
    const debtSource = r.sources.find((s) => s.id === "open-tech-debt");
    expect(debtSource?.reading?.value).toBe(2);
    expect(debtSource?.measures).toEqual(["metric_debt"]);
    expect(r.sources.find((s) => s.id === "nps-90d")?.reading).toBeNull();
    expect(metrics()[0].readings).toEqual([]);
    const a = await run<{ recorded: boolean; value: number }>(
      "tool.ebm_dashboard.accept_source_reading",
      {
        measureId: "metric_debt",
      }
    );
    expect(a).toMatchObject({ recorded: true, value: 2 });
    expect(metrics()[0].readings.map((x) => x.value)).toEqual([2]);
  });

  it("says why it can't read a source", async () => {
    useWorkspaceStore.setState({
      productMetrics: [
        {
          id: "metric_typed",
          name: "Typed",
          direction: "increase",
          kva: "current-value",
          readings: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "metric_nps",
          name: "NPS",
          direction: "increase",
          kva: "current-value",
          source: "nps-90d",
          readings: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    expect(
      await run("tool.ebm_dashboard.accept_source_reading", { measureId: "metric_typed" })
    ).toEqual({
      recorded: false,
      reason: "no_source",
    });
    expect(
      await run("tool.ebm_dashboard.accept_source_reading", { measureId: "metric_nps" })
    ).toEqual({
      recorded: false,
      reason: "no_reading",
    });
  });
});

describe("the board", () => {
  it("sets and clears the strategic goal", async () => {
    expect(
      await run("tool.ebm_dashboard.set_strategic_goal", {
        text: "More teams improve",
        why: "They stay",
      })
    ).toEqual({ set: true, strategicGoal: "More teams improve", strategicWhy: "They stay" });
    expect(board()).toMatchObject({ id: EBM_BOARD_ID, strategicGoal: "More teams improve" });
    expect(await run("tool.ebm_dashboard.set_strategic_goal", { text: null })).toEqual({
      set: true,
      strategicGoal: null,
      strategicWhy: null,
    });
  });

  it("suggests a focus without saving, and records a review of the team's own measures", async () => {
    const ex = buildEbmExample(todayLocalISO(), NOW);
    useWorkspaceStore.setState({ productMetrics: ex.metrics });
    const focus = await run<{ focus: string; steps: string[] }>("tool.ebm_dashboard.suggest_focus");
    expect(focus.steps.length).toBeGreaterThan(0);
    expect(board()).toBeUndefined();
    const r = await run<{ recorded: boolean; focus: string; areas: object }>(
      "tool.ebm_dashboard.record_review",
      { focus: "time-to-market", note: "Shorten reviews" }
    );
    expect(r).toMatchObject({ recorded: true, focus: "time-to-market", areas: {} });
    expect(board()?.reviews).toHaveLength(1);
  });

  it("records a review on the server", async () => {
    await mcp("tool.ebm_dashboard.record_review", { focus: "current-value" });
    expect((rows.get(`${EBM_BOARD_KIND}/${EBM_BOARD_ID}`) as EbmBoard).reviews).toHaveLength(1);
  });
});
