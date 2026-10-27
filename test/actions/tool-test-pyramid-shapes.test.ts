/**
 * tool.test_pyramid.* with shapes, runtimes and snapshots (Phase 8), on
 * both transports:
 *
 *   1. list_state — shape, shares, verdict and run cost equal
 *      lib/quality/pyramid; healthy / inverted keep their count meaning.
 *   2. set_counts — a new pyramid needs all three; runtimes merge; runtime
 *      weighting needs all three minutes; updatedOn stamped.
 *   3. take_snapshot / remove_snapshot — backdated, future refused, order.
 *   4. the browser and the server give the same answers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TestPyramid } from "@/lib/stores/workspace-types";
import {
  TEST_PYRAMID_ID,
  TEST_PYRAMID_KIND,
  classifyShape,
  layerShares,
  shapeVerdict,
} from "@/lib/quality/pyramid";
import { LEGACY_TEST_PYRAMID, TEST_PYRAMID } from "../stores/phase8-fixtures";

import "@/lib/actions/tools/test-pyramid";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
type Path = "handler" | "mcpHandler";
const PATHS: Path[] = ["handler", "mcpHandler"];
const run = <T>(path: Path, verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.test_pyramid.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

interface State {
  exists: boolean;
  unit: number;
  healthy: boolean;
  inverted: boolean;
  weighting: string;
  runtime: Record<string, number> | null;
  shares: { unit: number; integration: number; e2e: number } | null;
  shape: string;
  verdict: string;
  runCost: { basis: string; byLayer: Record<string, number>; total: number } | null;
  updatedOn: string | null;
  snapshotCount: number;
  latestSnapshot: { id: string; takenOn: string; note: string | null } | null;
  shapeHistory: { id: string; takenOn: string; shape: string | null; unitShare: number | null }[];
}

/** Put `doc` where `path` reads it. */
function seed(path: Path, doc: TestPyramid | null) {
  if (path === "handler") useWorkspaceStore.setState({ testPyramids: doc ? [doc] : [] });
  else if (doc) rows.set(`${TEST_PYRAMID_KIND}/${TEST_PYRAMID_ID}`, doc);
}

/** The document `path` wrote. */
function stored(path: Path): TestPyramid | undefined {
  return path === "handler"
    ? (useWorkspaceStore.getState().testPyramids ?? []).find((d) => d.id === TEST_PYRAMID_ID)
    : (rows.get(`${TEST_PYRAMID_KIND}/${TEST_PYRAMID_ID}`) as TestPyramid | undefined);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T10:00:00"));
  rows.clear();
  useWorkspaceStore.setState({ testPyramids: [] });
});
afterEach(() => vi.useRealTimers());

describe("tool.test_pyramid — registration", () => {
  it("the snapshot verbs write, without confirmation, on both paths", () => {
    for (const verb of ["set_counts", "take_snapshot", "remove_snapshot"]) {
      const action = registry.get(`tool.test_pyramid.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
      expect(action?.requiresConfirmation, verb).toBe(false);
    }
  });
});

describe.each(PATHS)("tool.test_pyramid.list_state (%s)", (path) => {
  it("names the shape from all three layers, as the library does", async () => {
    seed(path, LEGACY_TEST_PYRAMID);
    const r = await run<State>(path, "list_state");
    const shares = layerShares(LEGACY_TEST_PYRAMID);
    expect(r.shape).toBe("hourglass");
    expect(r.shape).toBe(classifyShape(shares));
    expect(r.verdict).toBe(shapeVerdict("hourglass", shares));
    expect(r.weighting).toBe("count");
    expect(r.runtime).toBeNull();
    expect(r.runCost).toEqual({
      basis: "count",
      byLayer: { unit: 120, integration: 200, e2e: 1500 },
      total: 1820,
    });
    // Unit outnumbers e2e, so the old flags read "not inverted" and "not healthy".
    expect(r.inverted).toBe(false);
    expect(r.healthy).toBe(false);
    expect(r.snapshotCount).toBe(0);
    expect(r.latestSnapshot).toBeNull();
  });

  it("weighs by runtime when the document does, and keeps healthy on the counts", async () => {
    seed(path, TEST_PYRAMID);
    const r = await run<State>(path, "list_state");
    expect(r.weighting).toBe("runtime");
    expect(r.shape).toBe("ice-cream-cone");
    expect(r.shares?.e2e).toBe(0.6386);
    expect(r.runCost).toEqual({
      basis: "runtime",
      byLayer: { unit: 4, integration: 11, e2e: 26.5 },
      total: 41.5,
    });
    expect(r.healthy).toBe(true); // 820 / 140 / 35 by count
    expect(r.updatedOn).toBe("2026-10-26");
    expect(r.snapshotCount).toBe(2);
    expect(r.latestSnapshot).toMatchObject({ id: "tps_bbbb2222", takenOn: "2026-10-01" });
    expect(r.shapeHistory).toEqual([
      { id: "tps_aaaa1111", takenOn: "2026-07-01", shape: null, unitShare: null },
      { id: "tps_bbbb2222", takenOn: "2026-10-01", shape: "ice-cream-cone", unitShare: 0.0964 },
    ]);
  });

  it("is empty before any write", async () => {
    const r = await run<State>(path, "list_state");
    expect(r).toMatchObject({ exists: false, shape: "empty", shares: null, runCost: null });
  });
});

describe.each(PATHS)("tool.test_pyramid.set_counts (%s)", (path) => {
  it("refuses a new pyramid with a layer left out, instead of a silent 0", async () => {
    expect(await run(path, "set_counts", { unit: 50 })).toMatchObject({
      updated: false,
      reason: "missing_counts",
    });
    expect(stored(path)).toBeUndefined();
  });

  it("creates with all three, stamps the day, merges later writes", async () => {
    expect(await run(path, "set_counts", { unit: 70, integration: 20, e2e: 10 })).toEqual({
      updated: true,
      shape: "pyramid",
    });
    expect(stored(path)?.updatedOn).toBe("2026-10-27");
    await run(path, "set_counts", { e2e: 80, description: "  main  " });
    expect(stored(path)).toMatchObject({ unit: 70, integration: 20, e2e: 80, description: "main" });
    await run(path, "set_counts", { description: null });
    expect(stored(path)?.description).toBeUndefined();
  });

  it("merges minutes per layer and weighs by runtime only with all three", async () => {
    seed(path, LEGACY_TEST_PYRAMID);
    await run(path, "set_counts", { runtime: { unit: 3, integration: 9 } });
    expect(await run(path, "set_counts", { weighting: "runtime" })).toMatchObject({
      updated: false,
      reason: "runtime_needed",
    });
    expect(await run(path, "set_counts", { runtime: { e2e: 30 }, weighting: "runtime" })).toEqual({
      updated: true,
      shape: "ice-cream-cone",
    });
    expect(stored(path)).toMatchObject({
      weighting: "runtime",
      runtime: { unit: 3, integration: 9, e2e: 30 },
    });
    // Clearing a layer's minutes while weighing by runtime is refused, not switched.
    expect(await run(path, "set_counts", { runtime: { e2e: null } })).toMatchObject({
      reason: "runtime_needed",
    });
    await run(path, "set_counts", { weighting: "count", runtime: null });
    expect(stored(path)?.weighting).toBe("count");
    expect(stored(path)?.runtime).toBeUndefined();
  });

  it("keeps the snapshots when the counts change", async () => {
    seed(path, TEST_PYRAMID);
    await run(path, "set_counts", { unit: 900 });
    expect(stored(path)?.snapshots).toHaveLength(2);
  });
});

describe.each(PATHS)("tool.test_pyramid snapshots (%s)", (path) => {
  it("needs counts first", async () => {
    expect(await run(path, "take_snapshot")).toMatchObject({ taken: false, reason: "no_counts" });
  });

  it("takes today's by default, a backdated one in day order, never a future one", async () => {
    seed(path, TEST_PYRAMID);
    const today = await run<{ taken: boolean; id: string; takenOn: string }>(
      path,
      "take_snapshot",
      { note: "release 4.2" }
    );
    expect(today).toMatchObject({ taken: true, takenOn: "2026-10-27" });
    expect(today.id).toMatch(/^tps_/);
    const back = await run<{ id: string }>(path, "take_snapshot", { takenOn: "2026-08-15" });
    expect(stored(path)?.snapshots?.map((s) => s.takenOn)).toEqual([
      "2026-07-01",
      "2026-08-15",
      "2026-10-01",
      "2026-10-27",
    ]);
    expect(stored(path)?.snapshots?.[3]).toMatchObject({ unit: 820, note: "release 4.2" });
    expect(await run(path, "take_snapshot", { takenOn: "2026-10-28" })).toEqual({
      taken: false,
      reason: "invalid_date",
      message: "takenOn: The day can't be after today.",
    });
    expect(await run(path, "remove_snapshot", { snapshotId: back.id })).toEqual({ removed: true });
    expect(stored(path)?.snapshots).toHaveLength(3);
    expect(await run(path, "remove_snapshot", { snapshotId: back.id })).toEqual({
      removed: false,
      reason: "not_found",
    });
  });
});

describe("tool.test_pyramid — both transports agree", () => {
  it("list_state reads the same document the same way", async () => {
    seed("handler", TEST_PYRAMID);
    seed("mcpHandler", TEST_PYRAMID);
    expect(await run("handler", "list_state")).toEqual(await run("mcpHandler", "list_state"));
  });
});
