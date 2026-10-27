/**
 * tool.hypothesis_tracker.* after Phase 8, on both transports: list_state
 * reads lib/hypotheses (rate null at no decisive result, examples left
 * out, a suggested verdict per row), add_hypothesis is checked as the
 * page's form is and goes first, set_status backdates a result and holds a
 * hand-off draft back, record_result suggests and never applies.
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
import type { Hypothesis, HypothesisTracker } from "@/lib/stores/workspace-types";
import {
  HYPOTHESIS_TRACKER_ID,
  hypothesisVerdict,
  suggestVerdict,
  validationRate,
} from "@/lib/hypotheses/model";

import "@/lib/actions/tools/hypothesis-tracker";

type Path = "handler" | "mcpHandler";
const TRANSPORTS: Path[] = ["handler", "mcpHandler"];
const KIND = "workspace:hypothesisTracker";
const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };

const run = <T = Record<string, unknown>>(
  path: Path,
  verb: string,
  params: Record<string, unknown> = {}
) => {
  const action = registry.get(`tool.hypothesis_tracker.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

function seed(path: Path, hypotheses: Hypothesis[]) {
  const doc: HypothesisTracker = { id: HYPOTHESIS_TRACKER_ID, hypotheses };
  if (path === "handler") useWorkspaceStore.setState({ hypothesisTrackers: [doc] });
  else rows.set(`${KIND}/${HYPOTHESIS_TRACKER_ID}`, doc);
}

function stored(path: Path): Hypothesis[] {
  const doc =
    path === "handler"
      ? (useWorkspaceStore.getState().hypothesisTrackers ?? []).find(
          (d) => d.id === HYPOTHESIS_TRACKER_ID
        )
      : (rows.get(`${KIND}/${HYPOTHESIS_TRACKER_ID}`) as HypothesisTracker | undefined);
  return doc?.hypotheses ?? [];
}

const hyp = (
  id: string,
  status: Hypothesis["status"],
  over: Partial<Hypothesis> = {}
): Hypothesis => ({
  id,
  believe: `b ${id}`,
  willDo: "w",
  toLearn: "l",
  successMetric: "m",
  status,
  raisedAt: "2026-10-01",
  ...over,
});

const base = { believe: "b", willDo: "w", toLearn: "l", successMetric: "m" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Tuesday 27 October 2026, mid-morning.
  vi.setSystemTime(new Date(2026, 9, 27, 10, 0, 0));
  rows.clear();
  useWorkspaceStore.setState({ hypothesisTrackers: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registration", () => {
  it("adds record_result as a write with a server path", () => {
    const a = registry.get("tool.hypothesis_tracker.record_result");
    expect(a?.category).toBe("write");
    expect(a?.mcpHandler).toBeTypeOf("function");
    expect(a?.requiresConfirmation).toBe(false);
  });
});

describe.each(TRANSPORTS)("%s", (path) => {
  describe("list_state", () => {
    it("is the library's rate: null with no decisive result, inconclusive not counted", async () => {
      seed(path, [hyp("a", "inconclusive"), hyp("b", "running")]);
      const r = await run(path, "list_state");
      expect(r).toMatchObject({ decisive: 0, inconclusive: 1, validationRate: null });
      expect(r.verdict).toBe(hypothesisVerdict(validationRate(stored(path))));
    });

    it("rounds the rate, leaves examples out, and suggests a verdict per row", async () => {
      const list = [
        hyp("a", "validated"),
        hyp("b", "validated"),
        hyp("c", "invalidated"),
        hyp("example-1", "invalidated"),
        hyp("d", "running", { target: { direction: "increase", value: 10 }, actual: 12 }),
        hyp("e", "drafted", { willDo: "", successMetric: " " }),
      ];
      seed(path, list);
      const r = (await run(path, "list_state")) as {
        validationRate: number;
        decisive: number;
        needsDetail: number;
        hypotheses: (Hypothesis & { suggestedVerdict: unknown; missing: string[] })[];
      };
      expect(r.validationRate).toBe(0.67);
      expect(r.decisive).toBe(3);
      expect(r.needsDetail).toBe(1);
      const d = r.hypotheses.find((h) => h.id === "d")!;
      expect(d.suggestedVerdict).toEqual(suggestVerdict(list[4]));
      expect(d.status).toBe("running");
      expect(r.hypotheses.find((h) => h.id === "e")!.missing).toEqual(["willDo", "successMetric"]);
    });
  });

  describe("add_hypothesis", () => {
    it("goes first, raised today, with a target and a measured result", async () => {
      seed(path, [hyp("old", "running")]);
      const r = await run(path, "add_hypothesis", {
        ...base,
        target: { direction: "increase", value: 12, unit: "%", baseline: 10 },
        actual: 14,
      });
      expect(r).toMatchObject({
        added: true,
        suggestedVerdict: { verdict: "validated", met: true },
      });
      const list = stored(path);
      expect(list.map((h) => h.id)).toEqual([r.id, "old"]);
      expect(list[0]).toMatchObject({
        status: "drafted",
        raisedAt: "2026-10-27",
        target: { direction: "increase", value: 12, unit: "%", baseline: 10 },
        actual: 14,
      });
      expect(list[0]).not.toHaveProperty("resolvedAt");
    });

    it("stamps a result's day for a status that has one, backdated or today", async () => {
      const a = await run(path, "add_hypothesis", {
        ...base,
        status: "validated",
        raisedAt: "2026-10-01",
      });
      const b = await run(path, "add_hypothesis", {
        ...base,
        status: "invalidated",
        raisedAt: "2026-10-01",
        resolvedAt: "2026-10-05",
      });
      const byId = new Map(stored(path).map((h) => [h.id, h]));
      expect(byId.get(a.id as string)?.resolvedAt).toBe("2026-10-27");
      expect(byId.get(b.id as string)?.resolvedAt).toBe("2026-10-05");
    });

    it("refuses what the page's form refuses, by the agent's param names", async () => {
      const wrongSide = await run(path, "add_hypothesis", {
        ...base,
        target: { direction: "increase", value: 5, baseline: 9 },
      });
      expect(wrongSide).toMatchObject({ added: false, reason: "invalid" });
      expect(Object.keys(wrongSide.errors as object)).toEqual(["target.value"]);

      const early = await run(path, "add_hypothesis", {
        ...base,
        status: "validated",
        raisedAt: "2026-10-10",
        resolvedAt: "2026-10-09",
      });
      expect(early).toMatchObject({ added: false, errors: { resolvedAt: expect.any(String) } });

      const noResult = await run(path, "add_hypothesis", { ...base, resolvedAt: "2026-10-09" });
      expect(noResult).toMatchObject({ added: false, errors: { resolvedAt: expect.any(String) } });

      const noTarget = await run(path, "add_hypothesis", { ...base, actual: 3 });
      expect(noTarget).toMatchObject({ added: false, errors: { actual: expect.any(String) } });

      const badDay = await run(path, "add_hypothesis", { ...base, raisedAt: "2026-02-30" });
      expect(badDay).toMatchObject({ added: false, errors: { raisedAt: expect.any(String) } });
      expect(stored(path)).toEqual([]);
    });

    it("takes the user's today over MCP, which may be the server's tomorrow; never later", async () => {
      const tomorrow = await run(path, "add_hypothesis", { ...base, raisedAt: "2026-10-28" });
      expect(tomorrow.added).toBe(path === "mcpHandler");
      const later = await run(path, "add_hypothesis", { ...base, raisedAt: "2026-10-29" });
      expect(later).toMatchObject({
        added: false,
        errors: { raisedAt: expect.stringMatching(/hasn't happened/) },
      });
    });
  });

  describe("set_status", () => {
    it("backdates a result's day, and clears it when the test reopens", async () => {
      seed(path, [hyp("h", "running", { raisedAt: "2026-10-10" })]);
      expect(
        await run(path, "set_status", {
          hypothesisId: "h",
          status: "validated",
          resolvedAt: "2026-10-20",
        })
      ).toEqual({
        updated: true,
        status: "validated",
        resolvedAt: "2026-10-20",
      });
      // Another result keeps the day already stamped.
      await run(path, "set_status", { hypothesisId: "h", status: "inconclusive" });
      expect(stored(path)[0].resolvedAt).toBe("2026-10-20");
      await run(path, "set_status", { hypothesisId: "h", status: "running" });
      expect(stored(path)[0]).not.toHaveProperty("resolvedAt");
    });

    it("refuses a day before it was raised, in the future, or that doesn't exist", async () => {
      seed(path, [hyp("h", "running", { raisedAt: "2026-10-10" })]);
      const set = (resolvedAt: string) =>
        run(path, "set_status", { hypothesisId: "h", status: "validated", resolvedAt });
      expect(await set("2026-10-09")).toEqual({ updated: false, reason: "before_raised" });
      expect(await set("2026-10-29")).toEqual({ updated: false, reason: "future_day" });
      expect(await set("2026-02-30")).toEqual({ updated: false, reason: "not_a_day" });
      expect(
        await run(path, "set_status", {
          hypothesisId: "h",
          status: "running",
          resolvedAt: "2026-10-12",
        })
      ).toEqual({
        updated: false,
        reason: "no_result",
      });
      expect(stored(path)[0].status).toBe("running");
    });

    it("holds a hand-off draft back until what we'll do and the success metric are filled", async () => {
      seed(path, [hyp("h", "drafted", { willDo: "", successMetric: "" })]);
      expect(await run(path, "set_status", { hypothesisId: "h", status: "running" })).toEqual({
        updated: false,
        reason: "needs_detail",
        missing: ["willDo", "successMetric"],
      });
      expect(
        (await run(path, "set_status", { hypothesisId: "h", status: "drafted" })).updated
      ).toBe(true);
      expect(await run(path, "set_status", { hypothesisId: "nope", status: "running" })).toEqual({
        updated: false,
        reason: "not_found",
      });
    });
  });

  describe("record_result", () => {
    it("records the number and suggests a verdict without applying it", async () => {
      seed(path, [
        hyp("h", "running", {
          target: { direction: "decrease", value: 5, unit: "s", baseline: 9 },
        }),
      ]);
      const r = await run(path, "record_result", { hypothesisId: "h", actual: 7 });
      expect(r).toEqual({
        updated: true,
        actual: 7,
        suggestedVerdict: { verdict: "invalidated", met: false, margin: -2, moved: -2 },
        suggestion:
          "Target missed: 7 s against at most 5 s (down 2 from 9 s). Suggested verdict: invalidated.",
      });
      expect(stored(path)[0]).toMatchObject({ actual: 7, status: "running" });
      await run(path, "record_result", { hypothesisId: "h", actual: null });
      expect(stored(path)[0]).not.toHaveProperty("actual");
    });

    it("needs a target, and a known hypothesis", async () => {
      seed(path, [hyp("h", "running")]);
      expect(await run(path, "record_result", { hypothesisId: "h", actual: 3 })).toEqual({
        updated: false,
        reason: "no_target",
      });
      expect(await run(path, "record_result", { hypothesisId: "x", actual: 3 })).toEqual({
        updated: false,
        reason: "not_found",
      });
    });
  });
});

describe("both transports", () => {
  it("store the same hypothesis for the same call", async () => {
    const params = {
      ...base,
      status: "validated",
      raisedAt: "2026-10-02",
      outcome: "It held",
      target: { direction: "increase", value: 3 },
      actual: 4,
    };
    const a = await run("handler", "add_hypothesis", params);
    const b = await run("mcpHandler", "add_hypothesis", params);
    const strip = (h: Hypothesis) => ({ ...h, id: "" });
    expect(strip(stored("handler")[0])).toEqual(strip(stored("mcpHandler")[0]));
    expect(a.suggestedVerdict).toEqual(b.suggestedVerdict);
  });
});
