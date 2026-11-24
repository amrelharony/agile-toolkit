/**
 * tool.ab_calculator.* coverage, in the browser and over MCP.
 *
 *   1. registration — three reads (two pure), two writes, each with an MCP handler.
 *   2. list_state — each test with its plan sized and its result read, the
 *      early look, the example counted apart.
 *   3. sample_size and analyze — the page's maths with zod caps.
 *   4. record_counts and set_decision — on the user's rows over MCP too.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AbTest } from "@/lib/stores/workspace-types";

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import "@/lib/actions/tools/ab-calculator";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const action = (verb: string) => registry.get(`tool.ab_calculator.${verb}`)!;
const run = async <T>(verb: string, params: Record<string, unknown> = {}, onServer = false) => {
  const a = action(verb);
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const AT = "2026-11-12T09:00:00.000Z";
const PLAN = {
  baseline: 0.1,
  mde: 0.2,
  mdeMode: "relative" as const,
  confidence: 0.95,
  power: 0.8,
  sided: "two" as const,
  dailyTraffic: 800,
};
const test = (over: Partial<AbTest> = {}): AbTest => ({
  id: "t1",
  name: "Shorter form",
  plan: { ...PLAN },
  variants: [
    { id: "a", name: "A", visitors: 4020, conversions: 402 },
    { id: "b", name: "B", visitors: 3980, conversions: 477 },
  ],
  status: "running",
  hypothesisId: "h1",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const ws = () => useWorkspaceStore.getState();
const stored = (id: string) => (ws().abTests ?? []).find((t) => t.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ abTests: [] });
});

describe("registration", () => {
  it("has three reads and two writes, each with an MCP handler, none asking first", () => {
    for (const name of ["list_state", "sample_size", "analyze"]) {
      expect(action(name).category, name).toBe("read");
    }
    for (const name of ["record_counts", "set_decision"]) {
      expect(action(name).category, name).toBe("write");
      expect(action(name).requiresConfirmation, name).toBe(false);
    }
    for (const name of ["list_state", "sample_size", "analyze", "record_counts", "set_decision"]) {
      expect(action(name).mcpHandler, name).toBeTypeOf("function");
      // No verb here reaches other people: visitors may use them all.
      expect(action(name).visitor, name).not.toBe(false);
    }
  });
});

describe("list_state", () => {
  it("reads each test as the page does, the example counted apart", async () => {
    useWorkspaceStore.setState({
      abTests: [
        test(),
        test({
          id: "example-ab-1",
          variants: [
            { id: "a", name: "A", visitors: 100, conversions: 10 },
            { id: "b", name: "B", visitors: 100, conversions: 12 },
          ],
        }),
      ],
    });
    const r = await run<{
      total: number;
      examples: number;
      howToRead: string;
      tests: {
        id: string;
        example: boolean;
        sized: { perVariant: number; days: number; weeks: number };
        result: {
          significant: boolean;
          p: number;
          verdict: string;
          sentence: string;
          early: { planned: number; smaller: number; met: boolean };
          split: { flagged: boolean };
          difference: number;
        };
      }[];
    }>("list_state");
    expect(r.total).toBe(1);
    expect(r.examples).toBe(1);
    expect(r.howToRead).toContain("range of effects");
    const [real, example] = r.tests;
    expect(real.sized).toMatchObject({ perVariant: 3841, days: 10, weeks: 2 });
    expect(real.result.significant).toBe(true);
    expect(real.result.p).toBeCloseTo(0.00453, 5);
    expect(real.result.difference).toBeCloseTo(0.019849, 5);
    expect(real.result.early).toEqual({ planned: 3841, smaller: 3980, met: true });
    expect(real.result.verdict).toBe(real.result.sentence);
    expect(example.example).toBe(true);
    expect(example.result.verdict).toBe("Too early to call: 100 of 3,841 per variant");
  });

  it("reads the user's rows over MCP, null result without counts", async () => {
    server.rows.set(
      "workspace:abTest/t2",
      test({
        id: "t2",
        variants: [
          { id: "a", name: "A", visitors: 0, conversions: 0 },
          { id: "b", name: "B", visitors: 0, conversions: 0 },
        ],
      })
    );
    const r = await run<{ tests: { id: string; result: unknown }[] }>("list_state", {}, true);
    expect(r.tests).toHaveLength(1);
    expect(r.tests[0].result).toBeNull();
  });
});

describe("sample_size", () => {
  it("sizes a plan and tables the smallest effect by weeks", async () => {
    const r = await run<{
      ok: boolean;
      perVariant: number;
      total: number;
      days: number;
      weeks: number;
      effects: { weeks: number; perVariant: number; absolute: number }[];
    }>("sample_size", PLAN);
    expect(r).toMatchObject({ ok: true, perVariant: 3841, total: 7682, days: 10, weeks: 2 });
    expect(r.effects.map((e) => e.weeks)).toEqual([1, 2, 3, 4]);
    const noTraffic = await run<{ days: null; effects: unknown[] }>("sample_size", {
      ...PLAN,
      dailyTraffic: undefined,
    });
    expect(noTraffic.days).toBeNull();
    expect(noTraffic.effects).toEqual([]);
  });

  it("says when the change takes B's rate past 100%, and refuses bad plans", async () => {
    expect(await run("sample_size", { ...PLAN, baseline: 0.9, mde: 0.2 })).toMatchObject({
      ok: false,
      reason: "out_of_range",
    });
    const schema = action("sample_size").paramsSchema;
    expect(schema.safeParse({ ...PLAN, baseline: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...PLAN, baseline: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...PLAN, confidence: 0.8 }).success).toBe(false);
    expect(schema.safeParse({ ...PLAN, power: 0.95 }).success).toBe(false);
    expect(schema.safeParse({ ...PLAN, dailyTraffic: 1.5 }).success).toBe(false);
  });
});

describe("analyze", () => {
  it("reads two versions' counts, with the plan's early look", async () => {
    const r = await run<{
      z: number;
      p: number;
      significant: boolean;
      verdict: string;
      note: string | null;
    }>("analyze", {
      a: { visitors: 1000, conversions: 200 },
      b: { visitors: 1000, conversions: 250 },
      plan: PLAN,
    });
    expect(r.z).toBeCloseTo(2.6774, 4);
    expect(r.p).toBeCloseTo(0.00742, 5);
    expect(r.significant).toBe(true);
    expect(r.verdict).toBe("Too early to call: 1,000 of 3,841 per variant");
    const noPlan = await run<{ note: string; verdict: string }>("analyze", {
      a: { visitors: 1000, conversions: 200 },
      b: { visitors: 1000, conversions: 250 },
    });
    expect(noPlan.note).toBe("Decide the sample before you start next time.");
    expect(noPlan.verdict).toMatch(/^B converted better than A/);
  });

  it("refuses counts that don't fit", () => {
    const schema = action("analyze").paramsSchema;
    const ok = { visitors: 10, conversions: 1 };
    expect(schema.safeParse({ a: ok, b: { visitors: 10, conversions: 11 } }).success).toBe(false);
    expect(schema.safeParse({ a: { visitors: 0, conversions: 0 }, b: ok }).success).toBe(false);
    expect(schema.safeParse({ a: { visitors: 2.5, conversions: 1 }, b: ok }).success).toBe(false);
    expect(schema.safeParse({ a: { visitors: 2e9, conversions: 1 }, b: ok }).success).toBe(false);
  });
});

describe("record_counts", () => {
  it("saves both versions' counts by id and returns the reading", async () => {
    useWorkspaceStore.setState({ abTests: [test()] });
    const r = await run<{ updated: boolean; result: { early: { met: boolean } } }>(
      "record_counts",
      {
        testId: "t1",
        variants: [
          { id: "b", visitors: 2000, conversions: 240 },
          { id: "a", visitors: 2010, conversions: 201 },
        ],
      }
    );
    expect(r.updated).toBe(true);
    expect(r.result.early.met).toBe(false);
    expect(stored("t1")?.variants).toEqual([
      { id: "a", name: "A", visitors: 2010, conversions: 201 },
      { id: "b", name: "B", visitors: 2000, conversions: 240 },
    ]);
    expect(stored("t1")?.updatedAt).not.toBe(AT);
  });

  it("refuses an unknown test or version", async () => {
    useWorkspaceStore.setState({ abTests: [test()] });
    expect(
      await run("record_counts", {
        testId: "nope",
        variants: [
          { id: "a", visitors: 1, conversions: 0 },
          { id: "b", visitors: 1, conversions: 0 },
        ],
      })
    ).toEqual({ updated: false, reason: "not_found" });
    expect(
      await run("record_counts", {
        testId: "t1",
        variants: [
          { id: "a", visitors: 1, conversions: 0 },
          { id: "a", visitors: 1, conversions: 0 },
        ],
      })
    ).toMatchObject({ updated: false, reason: "unknown_variant" });
    expect(
      action("record_counts").paramsSchema.safeParse({
        testId: "t1",
        variants: [
          { id: "a", visitors: 1, conversions: 2 },
          { id: "b", visitors: 1, conversions: 0 },
        ],
      }).success
    ).toBe(false);
  });

  it("writes the user's row over MCP", async () => {
    server.rows.set("workspace:abTest/t1", test());
    await run(
      "record_counts",
      {
        testId: "t1",
        variants: [
          { id: "a", visitors: 5, conversions: 1 },
          { id: "b", visitors: 6, conversions: 2 },
        ],
      },
      true
    );
    expect((server.rows.get("workspace:abTest/t1") as AbTest).variants[1].visitors).toBe(6);
  });
});

describe("set_decision", () => {
  it("records the decision with a note, and clears both", async () => {
    useWorkspaceStore.setState({ abTests: [test({ note: "old" })] });
    expect(await run("set_decision", { testId: "t1", decision: "ship", note: "B wins." })).toEqual({
      updated: true,
      id: "t1",
      decision: "ship",
      hypothesisId: "h1",
    });
    expect(stored("t1")).toMatchObject({ decision: "ship", note: "B wins." });
    await run("set_decision", { testId: "t1", decision: null, note: "" });
    expect(stored("t1")).not.toHaveProperty("decision");
    expect(stored("t1")).not.toHaveProperty("note");
    expect(await run("set_decision", { testId: "nope", decision: "keep" })).toEqual({
      updated: false,
      reason: "not_found",
    });
  });

  it("writes the user's row over MCP", async () => {
    server.rows.set("workspace:abTest/t1", test());
    await run("set_decision", { testId: "t1", decision: "rerun" }, true);
    expect((server.rows.get("workspace:abTest/t1") as AbTest).decision).toBe("rerun");
  });
});
