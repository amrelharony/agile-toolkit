/**
 * tool.product_metrics.* — Amr's Product Metrics verbs read and write the
 * same rows the page does, keep its rules (one North Star, a metric per
 * funnel stage), and the MCP path does the same against the server store.
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
import { PRODUCT_METRIC_KIND, type ProductMetric } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import "@/lib/actions/tools/product-metrics";
import { buildExample } from "@/app/(tools)/product-metrics/example";

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
const metric = (over: Partial<ProductMetric> = {}): ProductMetric => ({
  id: "metric_a",
  name: "Weekly teams",
  direction: "increase",
  readings: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const metrics = () => useWorkspaceStore.getState().productMetrics ?? [];
const seed = (ms: ProductMetric[]) =>
  useWorkspaceStore.setState({ productMetrics: ms, productGoals: [] });

beforeEach(() => {
  rows.clear();
  seed([]);
});

describe("registration", () => {
  it("has two reads and three writes, each write with a server handler, all for visitors", () => {
    for (const id of ["list_state", "suggest_metrics"]) {
      expect(registry.get(`tool.product_metrics.${id}`)?.category).toBe("read");
    }
    for (const id of ["add_reading", "add_funnel_period", "set_north_star"]) {
      const a = registry.get(`tool.product_metrics.${id}`);
      expect(a?.category).toBe("write");
      expect(a?.mcpHandler).toBeTypeOf("function");
      expect(a?.visitor).not.toBe(false);
    }
  });
});

describe("list_state", () => {
  it("reads the North Star, the funnel and every metric with its progress and trend", async () => {
    const today = todayLocalISO();
    seed(buildExample(today, NOW));
    const r = await run<{
      verdict: string;
      northStar: { id: string; progress: number; trend: string; example: boolean };
      inputs: unknown[];
      heart: { feature: string }[];
      funnel: { leakiest: string; nested: boolean; date: string };
      metrics: unknown[];
      exampleLoaded: boolean;
    }>("tool.product_metrics.list_state");
    expect(r.northStar.id).toBe("example-pm-north-star");
    expect(Math.round(r.northStar.progress * 100)).toBe(42);
    expect(r.northStar.trend).toBe("rising");
    expect(r.northStar.example).toBe(true);
    expect(r.inputs).toHaveLength(3);
    expect(r.heart[0].feature).toBe("Action follow-up");
    expect(r.funnel).toMatchObject({ leakiest: "activation", nested: true, date: today });
    expect(r.metrics).toHaveLength(12);
    expect(r.exampleLoaded).toBe(true);
    expect(r.verdict).toMatch(/No metrics yet/);
  });
});

describe("add_reading", () => {
  it("adds a reading, replaces one on the same day, and refuses a later day", async () => {
    seed([metric({ readings: [{ id: "r1", date: "2026-10-01", value: 10 }] })]);
    const today = todayLocalISO();
    const r = await run<{ recorded: boolean; replaced: boolean; change: number }>(
      "tool.product_metrics.add_reading",
      { metricId: "metric_a", value: 12 }
    );
    expect(r).toMatchObject({ recorded: true, replaced: false, change: 2 });
    const again = await run<{ replaced: boolean }>("tool.product_metrics.add_reading", {
      metricId: "metric_a",
      value: 13,
      date: today,
    });
    expect(again.replaced).toBe(true);
    expect(metrics()[0].readings.map((x) => x.value)).toEqual([10, 13]);
    await expect(
      run("tool.product_metrics.add_reading", {
        metricId: "metric_a",
        value: 1,
        date: "2999-01-01",
      })
    ).rejects.toThrow(/after today/);
    expect(await run("tool.product_metrics.add_reading", { metricId: "nope", value: 1 })).toEqual({
      recorded: false,
      reason: "not_found",
    });
  });

  it("writes on the server", async () => {
    rows.set(`${PRODUCT_METRIC_KIND}/metric_a`, metric());
    const r = await mcp<{ recorded: boolean }>("tool.product_metrics.add_reading", {
      metricId: "metric_a",
      value: 5,
    });
    expect(r.recorded).toBe(true);
    expect((rows.get(`${PRODUCT_METRIC_KIND}/metric_a`) as ProductMetric).readings).toHaveLength(1);
  });
});

describe("add_funnel_period", () => {
  const stage = (id: string, aarrr: ProductMetric["aarrr"]) => metric({ id, name: id, aarrr });

  it("writes one reading per stage on the same day", async () => {
    seed([stage("metric_acq", "acquisition"), stage("metric_act", "activation")]);
    const r = await run<{ recorded: boolean; stages: string[]; leakiest: string }>(
      "tool.product_metrics.add_funnel_period",
      { counts: { acquisition: 100, activation: 30 } }
    );
    expect(r).toMatchObject({
      recorded: true,
      stages: ["acquisition", "activation"],
      leakiest: "activation",
    });
    expect(metrics().map((m) => m.readings[0]?.value)).toEqual([100, 30]);
  });

  it("needs Acquisition and another stage, each with a metric", async () => {
    seed([stage("metric_acq", "acquisition")]);
    expect(
      await run("tool.product_metrics.add_funnel_period", { counts: { acquisition: 100 } })
    ).toEqual({ recorded: false, reason: "need_acquisition_and_another" });
    expect(
      await run("tool.product_metrics.add_funnel_period", {
        counts: { acquisition: 100, retention: 20 },
      })
    ).toEqual({ recorded: false, reason: "no_stage_metric", stages: ["retention"] });
  });
});

describe("set_north_star", () => {
  it("clears the old North Star first, in the browser and on the server", async () => {
    seed([
      metric({ id: "metric_old", role: "north-star" }),
      metric({ id: "metric_new", role: "input" }),
    ]);
    const r = await run("tool.product_metrics.set_north_star", { metricId: "metric_new" });
    expect(r).toEqual({ set: true, metricId: "metric_new", previous: "metric_old" });
    expect(metrics().map((m) => [m.id, m.role])).toEqual([
      ["metric_old", undefined],
      ["metric_new", "north-star"],
    ]);
    expect(await run("tool.product_metrics.set_north_star", { metricId: "metric_new" })).toEqual({
      set: false,
      reason: "already",
    });

    rows.set(`${PRODUCT_METRIC_KIND}/metric_old`, metric({ id: "metric_old", role: "north-star" }));
    rows.set(`${PRODUCT_METRIC_KIND}/metric_new`, metric({ id: "metric_new" }));
    await mcp("tool.product_metrics.set_north_star", { metricId: "metric_new" });
    expect((rows.get(`${PRODUCT_METRIC_KIND}/metric_old`) as ProductMetric).role).toBeUndefined();
    expect((rows.get(`${PRODUCT_METRIC_KIND}/metric_new`) as ProductMetric).role).toBe(
      "north-star"
    );
  });

  it("leaves the example's North Star alone when the team sets its own", async () => {
    seed([metric({ id: "example-pm-ns", role: "north-star" }), metric({ id: "metric_mine" })]);
    expect(await run("tool.product_metrics.set_north_star", { metricId: "metric_mine" })).toEqual({
      set: true,
      metricId: "metric_mine",
      previous: null,
    });
    expect(metrics().find((m) => m.id === "example-pm-ns")?.role).toBe("north-star");
  });
});

describe("suggest_metrics", () => {
  it("answers from the templates, without names the team has", async () => {
    const r = await run<{ metrics: { name: string; aarrrStage?: string }[] }>(
      "tool.product_metrics.suggest_metrics",
      { framework: "aarrr", existing: ["Visitors who sign up"] }
    );
    expect(r.metrics.map((m) => m.aarrrStage)).toEqual([
      "activation",
      "retention",
      "referral",
      "revenue",
    ]);
    expect(metrics()).toEqual([]);
  });
});
