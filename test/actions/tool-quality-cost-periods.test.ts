/**
 * tool.quality_cost.* with periods (Phase 8):
 *
 *   1. compute_cost_of_quality — optional costs, hours × rate, failureShare.
 *   2. list_periods — reads the page's blob in the browser (localStorage)
 *      and on the server (user_state), and both equal lib/quality/cost.
 *   3. the figures from before periods come back as `legacy`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path reads the user_state blobs by key.
const blobs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
  };
});

import { registry } from "@/lib/actions/registry";
import {
  QUALITY_COST_KEY,
  costBreakdown,
  failureShareTrend,
  failureShareVerdict,
  normalizeQualityCostState,
} from "@/lib/quality/cost";

import "@/lib/actions/tools/quality-cost";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T>(path: "handler" | "mcpHandler", verb: string, params: Record<string, unknown>) => {
  const action = registry.get(`tool.quality_cost.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

interface Periods {
  exists: boolean;
  hourlyRate: number | null;
  periods: { id: string; period: string; failureShare: number | null; total: number }[];
  trend: {
    points: { period: string; share: number | null }[];
    changeVsPrevious: number | null;
    mannKendall: unknown;
  };
  verdict: string | null;
  legacy: { costs: Record<string, number>; description: string | null; total: number } | null;
}

const BLOB = {
  hourlyRate: 95,
  periods: [
    {
      id: "qcp_b",
      period: "2026-Q3",
      costs: { prevention: 4000, detection: 1800, internalFailure: 2900, externalFailure: 1300 },
    },
    {
      id: "qcp_a",
      period: "2026-Q2",
      costs: { prevention: 4200, detection: 2400, internalFailure: 2400, externalFailure: 1000 },
      hours: { detection: 25 },
      note: "Release crunch",
    },
  ],
};

/** Both transports see `blob`: the browser's localStorage copy and the user_state row. */
function store(blob: unknown) {
  blobs.clear();
  window.localStorage.clear();
  if (blob !== undefined) {
    blobs.set(QUALITY_COST_KEY, blob);
    window.localStorage.setItem(QUALITY_COST_KEY, JSON.stringify(blob));
  }
}

beforeEach(() => store(undefined));

describe("tool.quality_cost — registration", () => {
  it("list_periods is a read with an MCP handler; compute stays pure", () => {
    const list = registry.get("tool.quality_cost.list_periods");
    expect(list?.category).toBe("read");
    expect(list?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.quality_cost.compute_cost_of_quality")?.mcpHandler).toBeUndefined();
  });
});

describe("tool.quality_cost.compute_cost_of_quality", () => {
  it("leaves a cost out as not entered, and has no share without a failure figure", async () => {
    const r = await run<{
      totalCoq: number;
      entered: number;
      missing: string[];
      failureShare: number | null;
      failurePct: number;
    }>("handler", "compute_cost_of_quality", { preventionCost: 100, detectionCost: 50 });
    expect(r.totalCoq).toBe(150);
    expect(r.entered).toBe(2);
    expect(r.missing).toEqual(["internalFailure", "externalFailure"]);
    expect(r.failureShare).toBeNull();
    // Kept for older callers: 0 of a non-zero total.
    expect(r.failurePct).toBe(0);
  });

  it("fills a missing cost from hours × the rate", async () => {
    const r = await run<{
      costs: Record<string, number>;
      filledFromHours: string[];
      needRate: string[];
      failureShare: number;
      totalCoq: number;
    }>("handler", "compute_cost_of_quality", {
      preventionCost: 600,
      internalFailureCost: 200,
      hours: { detection: 2, externalFailure: 1 },
      hourlyRate: 100,
    });
    expect(r.costs).toEqual({
      prevention: 600,
      detection: 200,
      internalFailure: 200,
      externalFailure: 100,
    });
    expect(r.filledFromHours).toEqual(["detection", "externalFailure"]);
    expect(r.totalCoq).toBe(1100);
    expect(r.failureShare).toBe(0.2727);
  });

  it("names hours it couldn't cost without a rate", async () => {
    const r = await run<{ needRate: string[]; entered: number }>(
      "handler",
      "compute_cost_of_quality",
      { hours: { prevention: 3 } }
    );
    expect(r.needRate).toEqual(["prevention"]);
    expect(r.entered).toBe(0);
  });

  it("refuses a negative cost or rate", () => {
    const schema = registry.get("tool.quality_cost.compute_cost_of_quality")!.paramsSchema;
    expect(schema.safeParse({ preventionCost: -1 }).success).toBe(false);
    expect(schema.safeParse({ hourlyRate: -5 }).success).toBe(false);
  });
});

describe("tool.quality_cost.list_periods", () => {
  it("reads nothing as a first run, on both transports", async () => {
    for (const path of ["handler", "mcpHandler"] as const) {
      const r = await run<Periods>(path, "list_periods", {});
      expect(r, path).toMatchObject({
        exists: false,
        hourlyRate: null,
        periods: [],
        verdict: null,
        legacy: null,
      });
    }
  });

  it("lists the quarters oldest first with the library's shares and verdict", async () => {
    store(BLOB);
    const r = await run<Periods>("mcpHandler", "list_periods", {});
    const state = normalizeQualityCostState(BLOB);
    const trend = failureShareTrend(state.periods ?? []);
    expect(r.exists).toBe(true);
    expect(r.hourlyRate).toBe(95);
    expect(r.periods.map((p) => p.period)).toEqual(["2026-Q2", "2026-Q3"]);
    expect(r.periods[1].failureShare).toBe(
      Number((costBreakdown(BLOB.periods[0].costs).failureShare as number).toFixed(4))
    );
    expect(r.periods[0]).toMatchObject({ note: "Release crunch", hours: { detection: 25 } });
    expect(r.trend.changeVsPrevious).toBeCloseTo(trend.changeVsPrevious as number, 4);
    expect(r.trend.mannKendall).toBeNull();
    expect(r.verdict).toBe(failureShareVerdict(trend));
    expect(r.verdict).toBe(
      "Failure costs were 42% of quality spend in 2026-Q3, up 8 points on 2026-Q2. That is above the 30% mark."
    );
  });

  it("gives the same answer in the browser and on the server", async () => {
    store(BLOB);
    expect(await run("handler", "list_periods", {})).toEqual(
      await run("mcpHandler", "list_periods", {})
    );
  });

  it("returns the figures from before periods as legacy until saved as a quarter", async () => {
    store({
      preventionCost: 1200,
      detectionCost: 0,
      internalFailureCost: 300,
      externalFailureCost: 500,
      description: "Rough Q2",
    });
    const r = await run<Periods>("mcpHandler", "list_periods", {});
    expect(r.periods).toEqual([]);
    expect(r.legacy).toMatchObject({
      costs: { prevention: 1200, detection: 0, internalFailure: 300, externalFailure: 500 },
      description: "Rough Q2",
      total: 2000,
    });
    // The old page's untouched zeros are a first run, not figures.
    store({ preventionCost: 0, detectionCost: 0, internalFailureCost: 0, externalFailureCost: 0 });
    expect((await run<Periods>("handler", "list_periods", {})).legacy).toBeNull();
  });

  it("reads a corrupt browser copy as nothing", async () => {
    window.localStorage.setItem(QUALITY_COST_KEY, "{not json");
    expect((await run<Periods>("handler", "list_periods", {})).exists).toBe(false);
  });
});
