/**
 * tool.hypothesis_tracker's value-check verbs (P2.5), in the browser and
 * over MCP: list_state's valueChecks and per-row valueCheck,
 * list_value_candidates, add_value_check (checked as the page's form),
 * set_measured_by, read_measure (read only) and use_ab_result (the result
 * sentence into what we learned; the number only when the test is in).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AbTest,
  Hypothesis,
  HypothesisTracker,
  ProductMetric,
  Story,
} from "@/lib/stores/workspace-types";

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
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => server.rows.get(key(kind, id)) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { ENTITY_ROW_MAX_BYTES } from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { TRACKER_FULL } from "@/lib/hypotheses/value";
import { addDays } from "@/lib/flow/days";
import { todayLocalISO } from "@/lib/utils/formatters";
import "@/lib/actions/tools/hypothesis-tracker";

const TODAY = todayLocalISO();
const ago = (n: number) => addDays(TODAY, -n) as string;
const AT = "2026-11-01T09:00:00.000Z";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const action = (verb: string) => registry.get(`tool.hypothesis_tracker.${verb}`)!;
const run = async <T>(verb: string, params: Record<string, unknown> = {}, onServer = false) => {
  const a = action(verb);
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const hyp = (id: string, over: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `belief ${id}`,
  willDo: "do it",
  toLearn: "learn it",
  successMetric: "sign-ups",
  status: "running",
  raisedAt: ago(20),
  ...over,
});
const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  doneAt: `${ago(5)}T12:00:00`,
  ...over,
});
const metric: ProductMetric = {
  id: "m1",
  name: "Weekly active teams",
  unit: "teams",
  direction: "increase",
  baseline: 40,
  readings: [
    { id: "r1", date: ago(10), value: 45 },
    { id: "r2", date: ago(1), value: 58 },
  ],
  createdAt: AT,
  updatedAt: AT,
};
const abTest = (over: Partial<AbTest> = {}): AbTest => ({
  id: "t1",
  name: "Shorter form",
  hypothesisId: "h1",
  plan: {
    baseline: 0.1,
    mde: 0.2,
    mdeMode: "relative",
    confidence: 0.95,
    power: 0.8,
    sided: "two",
  },
  variants: [
    { id: "a", name: "A", visitors: 4020, conversions: 402 },
    { id: "b", name: "B", visitors: 3980, conversions: 477 },
  ],
  status: "done",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const list = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];
const one = (id: string) => list().find((h) => h.id === id);
const seed = (hypotheses: Hypothesis[], extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({
    hypothesisTrackers: [{ id: HYPOTHESIS_TRACKER_ID, hypotheses }],
    stories: [],
    epicRoadmaps: [],
    productMetrics: [],
    okrs: [],
    abTests: [],
    ...extra,
  });
const serverDoc = () =>
  (
    server.rows.get(`workspace:hypothesisTracker/${HYPOTHESIS_TRACKER_ID}`) as
      | HypothesisTracker
      | undefined
  )?.hypotheses ?? [];
/** A hypothesis that leaves `room` bytes in the tracker's one row beside `others`. */
const nearlyFull = (others: Hypothesis[] = [], room = 100): Hypothesis => {
  const doc = (description: string) => ({
    id: HYPOTHESIS_TRACKER_ID,
    hypotheses: [...others, hyp("big", { description })],
  });
  return hyp("big", { description: "x".repeat(ENTITY_ROW_MAX_BYTES - room - jsonBytes(doc(""))) });
};

beforeEach(() => {
  server.rows.clear();
  seed([]);
});

describe("registration", () => {
  it("adds two reads and three writes, each with an MCP handler, none asking first", () => {
    for (const verb of ["list_value_candidates", "read_measure"]) {
      expect(action(verb).category, verb).toBe("read");
    }
    for (const verb of ["add_value_check", "set_measured_by", "use_ab_result"]) {
      expect(action(verb).category, verb).toBe("write");
      expect(action(verb).requiresConfirmation, verb).toBe(false);
    }
    for (const verb of [
      "list_value_candidates",
      "add_value_check",
      "set_measured_by",
      "read_measure",
      "use_ab_result",
    ]) {
      expect(action(verb).mcpHandler, verb).toBeTypeOf("function");
    }
  });
});

describe("list_state", () => {
  it("counts the value checks and says which are due, as new keys only", async () => {
    const shipped = { kind: "story" as const, id: "s1", title: "Checklist", doneAt: ago(40) };
    seed([
      hyp("due", { shipped, checkOn: ago(1) }),
      hyp("later", { shipped, checkOn: addDays(TODAY, 5) as string }),
      hyp("done", { shipped, status: "validated", resolvedAt: ago(1) }),
      hyp("plain"),
    ]);
    const r = await run<{
      valueChecks: Record<string, unknown>;
      hypotheses: (Hypothesis & { valueCheck: unknown })[];
    }>("list_state");
    expect(r.valueChecks).toEqual({
      total: 3,
      open: 2,
      due: 1,
      validated: 1,
      invalidated: 0,
      inconclusive: 0,
      rate: 1,
    });
    const byId = Object.fromEntries(r.hypotheses.map((h) => [h.id, h]));
    expect(byId.due.valueCheck).toEqual({ due: true, checkOn: ago(1) });
    expect(byId.due.shipped).toEqual(shipped);
    expect(byId.plain.valueCheck).toBeNull();
  });
});

describe("list_value_candidates and add_value_check", () => {
  it("lists recent shipped work and adds a check on it, measured by a metric with a target", async () => {
    seed([], {
      stories: [story("s1"), story("old", { doneAt: `${ago(120)}T12:00:00` })],
      productMetrics: [metric],
    });
    const c = await run<{ total: number; candidates: { id: string; doneAt: string }[] }>(
      "list_value_candidates"
    );
    expect(c.total).toBe(1);
    expect(c.candidates[0]).toEqual({ kind: "story", id: "s1", title: "Story s1", doneAt: ago(5) });

    const refused = await run<{ added: boolean; errors: Record<string, string> }>(
      "add_value_check",
      {
        kind: "story",
        id: "s1",
        measuredBy: { kind: "metric", metricId: "m1" },
      }
    );
    expect(refused.added).toBe(false);
    expect(refused.errors["target.direction"]).toMatch(/needs a target/);

    const r = await run<{ added: boolean; id: string; checkOn: string }>("add_value_check", {
      kind: "story",
      id: "s1",
      lookAfterDays: 14,
      measuredBy: { kind: "metric", metricId: "m1" },
      target: { direction: "increase", value: 55, unit: "teams", baseline: 45 },
    });
    expect(r.added).toBe(true);
    expect(r.checkOn).toBe(addDays(ago(5), 14));
    expect(one(r.id)).toMatchObject({
      status: "running",
      believe: "shipping “Story s1” gave people the value we expected",
      shipped: { kind: "story", id: "s1", title: "Story s1", doneAt: ago(5) },
      measuredBy: { kind: "metric", metricId: "m1" },
      target: { direction: "increase", value: 55, unit: "teams", baseline: 45 },
    });
    expect(list()[0].id).toBe(r.id);
    expect(
      await run("add_value_check", {
        kind: "story",
        id: "s1",
        measuredBy: { kind: "words", note: "x" },
      })
    ).toEqual({
      added: false,
      reason: "already_checked",
    });
  });

  it("refuses work that isn't a candidate, and an epic with no day unless one is given", async () => {
    seed([], {
      stories: [],
      epicRoadmaps: [
        {
          id: "epicRoadmap:current",
          epics: [
            {
              id: "e1",
              title: "Pay",
              startQuarter: "2026-Q4",
              endQuarter: "2026-Q4",
              progress: 100,
            },
          ],
        },
      ],
    });
    expect(
      await run("add_value_check", {
        kind: "story",
        id: "nope",
        measuredBy: { kind: "words", note: "x" },
      })
    ).toMatchObject({ added: false, reason: "not_found" });
    expect(
      await run("add_value_check", {
        kind: "epic",
        id: "e1",
        measuredBy: { kind: "words", note: "x" },
      })
    ).toMatchObject({ added: false, reason: "needs_day" });
    const r = await run<{ added: boolean }>("add_value_check", {
      kind: "epic",
      id: "e1",
      doneAt: ago(3),
      measuredBy: { kind: "words", note: "fewer failed payments" },
    });
    expect(r.added).toBe(true);
  });

  it("works on the user's rows over MCP", async () => {
    server.rows.set("workspace:story/s1", story("s1"));
    const c = await run<{ total: number }>("list_value_candidates", {}, true);
    expect(c.total).toBe(1);
    const r = await run<{ added: boolean; id: string }>(
      "add_value_check",
      { kind: "story", id: "s1", measuredBy: { kind: "words", note: "fewer tickets" } },
      true
    );
    expect(r.added).toBe(true);
    expect(serverDoc()[0]).toMatchObject({
      id: r.id,
      measuredBy: { kind: "words", note: "fewer tickets" },
      // Raised on the server's own today, never the day after it allows.
      raisedAt: TODAY,
    });
  });

  it("over MCP allows the user's tomorrow as the ship day, still raised today", async () => {
    const tomorrow = addDays(TODAY, 1) as string;
    server.rows.set("workspace:epicRoadmap/epicRoadmap:current", {
      id: "epicRoadmap:current",
      epics: [
        { id: "e1", title: "Pay", startQuarter: "2026-Q4", endQuarter: "2026-Q4", progress: 100 },
      ],
    } as unknown as { id: string });
    const r = await run<{ added: boolean; id: string }>(
      "add_value_check",
      {
        kind: "epic",
        id: "e1",
        doneAt: tomorrow,
        measuredBy: { kind: "words", note: "fewer failed payments" },
      },
      true
    );
    expect(r.added).toBe(true);
    expect(serverDoc()[0]).toMatchObject({
      raisedAt: TODAY,
      shipped: { kind: "epic", id: "e1", doneAt: tomorrow },
    });
    // In the browser the user's today is the latest day.
    seed([], { epicRoadmaps: [server.rows.get("workspace:epicRoadmap/epicRoadmap:current")] });
    const local = await run<{ added: boolean; errors: Record<string, string> }>("add_value_check", {
      kind: "epic",
      id: "e1",
      doneAt: tomorrow,
      measuredBy: { kind: "words", note: "fewer failed payments" },
    });
    expect(local.added).toBe(false);
    expect(Object.values(local.errors).join(" ")).toMatch(/hasn't happened yet/);
  });

  it("refuses a check that would take the tracker past its one row, in the browser and over MCP", async () => {
    const big = nearlyFull();
    seed([big], { stories: [story("s1")] });
    const params = {
      kind: "story",
      id: "s1",
      measuredBy: { kind: "words", note: "fewer tickets" },
    };
    expect(await run("add_value_check", params)).toEqual({
      added: false,
      reason: "too_large",
      message: TRACKER_FULL,
    });
    expect(list()).toEqual([big]);
    server.rows.set(`workspace:hypothesisTracker/${HYPOTHESIS_TRACKER_ID}`, {
      id: HYPOTHESIS_TRACKER_ID,
      hypotheses: [big],
    } as HypothesisTracker);
    server.rows.set("workspace:story/s1", story("s1"));
    expect(await run("add_value_check", params, true)).toMatchObject({
      added: false,
      reason: "too_large",
    });
    expect(serverDoc()).toEqual([big]);
  });
});

describe("set_measured_by", () => {
  it("sets a measure on any hypothesis, refuses one that isn't there, and clears it", async () => {
    seed([hyp("h1")], { productMetrics: [metric] });
    expect(
      await run("set_measured_by", {
        hypothesisId: "h1",
        measuredBy: { kind: "metric", metricId: "m1" },
      })
    ).toEqual({
      updated: true,
      id: "h1",
      measuredBy: { kind: "metric", metricId: "m1" },
    });
    expect(one("h1")?.measuredBy).toEqual({ kind: "metric", metricId: "m1" });
    expect(
      await run("set_measured_by", {
        hypothesisId: "h1",
        measuredBy: { kind: "metric", metricId: "gone" },
      })
    ).toMatchObject({
      updated: false,
      reason: "invalid",
      errors: { "measuredBy.metricId": expect.any(String) },
    });
    await run("set_measured_by", { hypothesisId: "h1", measuredBy: null });
    expect(one("h1")).not.toHaveProperty("measuredBy");
    expect(await run("set_measured_by", { hypothesisId: "x", measuredBy: null })).toEqual({
      updated: false,
      reason: "not_found",
    });
  });
});

describe("read_measure", () => {
  it("says what Read the metric would record, and saves nothing", async () => {
    const check = hyp("h1", {
      shipped: { kind: "story", id: "s1", title: "Checklist", doneAt: ago(20) },
      checkOn: ago(3),
      measuredBy: { kind: "metric", metricId: "m1" },
      target: { direction: "increase", value: 55, unit: "teams" },
    });
    seed([check], { productMetrics: [metric] });
    const r = await run<{ state: string; reading: unknown; suggestedVerdict: { verdict: string } }>(
      "read_measure",
      { hypothesisId: "h1" }
    );
    expect(r.state).toBe("ready");
    expect(r.reading).toEqual({ date: ago(1), value: 58 });
    expect(r.suggestedVerdict.verdict).toBe("validated");
    expect(one("h1")).not.toHaveProperty("actual");
    expect(await run("read_measure", { hypothesisId: "nope" })).toEqual({ found: false });
    seed([{ ...check, checkOn: TODAY }], { productMetrics: [metric] });
    expect(await run("read_measure", { hypothesisId: "h1" })).toMatchObject({
      state: "no_reading",
      measure: "Weekly active teams",
    });
  });
});

describe("use_ab_result", () => {
  const pct = hyp("h1", {
    target: { direction: "increase", value: 11.5, unit: "%", baseline: 10 },
  });

  it("adds the sentence and the measured result when the test is in, never the status", async () => {
    seed([pct], { abTests: [abTest()] });
    const r = await run<{
      updated: boolean;
      actualSet: boolean;
      actual: number;
      suggestedVerdict: { verdict: string };
    }>("use_ab_result", { hypothesisId: "h1" });
    expect(r).toMatchObject({ updated: true, testId: "t1", actualSet: true, actual: 11.98 });
    expect(r.suggestedVerdict.verdict).toBe("validated");
    expect(one("h1")).toMatchObject({ status: "running", actual: 11.98 });
    expect(one("h1")?.outcome).toMatch(/^A\/B test “Shorter form”: B converted better than A/);
    expect(await run("use_ab_result", { hypothesisId: "h1" })).toMatchObject({
      updated: false,
      reason: "already_used",
    });
  });

  it("says it is too early below the planned sample, and sets no number", async () => {
    seed([pct], {
      abTests: [
        abTest({
          variants: [
            { id: "a", name: "A", visitors: 600, conversions: 48 },
            { id: "b", name: "B", visitors: 600, conversions: 84 },
          ],
        }),
      ],
    });
    const r = await run<{ updated: boolean; sentence: string; actualSet: boolean }>(
      "use_ab_result",
      { hypothesisId: "h1" }
    );
    expect(r).toMatchObject({ updated: true, actualSet: false, suggestedVerdict: null });
    expect(r.sentence).toMatch(
      /^A\/B test “Shorter form”: Too early to call: 600 of 3,841 per variant\. So far: B converted better than A/
    );
    expect(one("h1")?.outcome).toBe(r.sentence);
    expect(one("h1")).not.toHaveProperty("actual");
  });

  it("refuses a result that would take the tracker past its one row", async () => {
    const big = nearlyFull([pct]);
    seed([pct, big], { abTests: [abTest()] });
    expect(await run("use_ab_result", { hypothesisId: "h1" })).toEqual({
      updated: false,
      reason: "too_large",
      message: TRACKER_FULL,
    });
    expect(one("h1")).not.toHaveProperty("outcome");
  });

  it("refuses with no test or no counts", async () => {
    seed([pct]);
    expect(await run("use_ab_result", { hypothesisId: "h1" })).toMatchObject({
      updated: false,
      reason: "no_test",
    });
    seed([pct], {
      abTests: [
        abTest({
          variants: [
            { id: "a", name: "A", visitors: 0, conversions: 0 },
            { id: "b", name: "B", visitors: 0, conversions: 0 },
          ],
        }),
      ],
    });
    expect(await run("use_ab_result", { hypothesisId: "h1" })).toMatchObject({
      updated: false,
      reason: "no_result",
    });
    expect(await run("use_ab_result", { hypothesisId: "x" })).toEqual({
      updated: false,
      reason: "not_found",
    });
  });

  it("reads the user's A/B tests over MCP", async () => {
    server.rows.set(`workspace:hypothesisTracker/${HYPOTHESIS_TRACKER_ID}`, {
      id: HYPOTHESIS_TRACKER_ID,
      hypotheses: [pct],
    } as HypothesisTracker);
    server.rows.set("workspace:abTest/t1", abTest());
    const r = await run<{ updated: boolean }>("use_ab_result", { hypothesisId: "h1" }, true);
    expect(r.updated).toBe(true);
    expect(serverDoc()[0].actual).toBe(11.98);
  });
});
