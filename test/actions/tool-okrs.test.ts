/**
 * tool.okrs.* coverage (WIRE over the synced okr entity).
 *
 *   1. registration — list_state read; check_in and update_key_result
 *      write, with MCP handlers and no confirm
 *   2. list_state — lib/okrs' numbers: progress from baseline to target
 *      (clamped), objective-weighted overall, confidence, last check-in,
 *      verdict and the sprint goals that link each objective; example rows
 *      left out
 *   3. check_in — a dated check-in mirrored into current and confidence;
 *      backdating, the future refused, the cap
 *   4. update_key_result — records a check-in; unknown okr/kr → {updated:false}
 *   5. the MCP path — the same results from the server store
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
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KeyResult, Okr, Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import {
  confidenceTrend,
  krPercent,
  objectiveConfidence,
  objectivePercent,
  okrVerdict,
  overallProgress,
  progressTrend,
  withoutCheckIn,
} from "@/lib/okrs/progress";
import { sprintGoalsFor } from "@/lib/okrs/links";
import { blankGoal } from "@/lib/sprints/goal-doc";
import { exampleId } from "@/lib/utils/example-id";
import { FULL_CHECK_INS, LEGACY_OKR, OKR } from "../stores/phase8-fixtures";

import "@/lib/actions/tools/okrs";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T>(path: "handler" | "mcpHandler", verb: string, params: Record<string, unknown>) => {
  const action = registry.get(`tool.okrs.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};
const call = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("handler", verb, params);
const callMcp = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("mcpHandler", verb, params);

/** 3 Nov 2026, noon local: only Date is faked, so promises run as usual. */
const NOW = new Date(2026, 10, 3, 12);

function okr(id: string, krs: { id: string; target: number; current: number }[]): Okr {
  return {
    id,
    objective: `obj ${id}`,
    quarter: "2026-Q1",
    keyResults: krs.map((k) => ({ id: k.id, title: k.id, target: k.target, current: k.current })),
  };
}

const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 14",
  startDate: "2026-10-12",
  endDate: "2026-10-25",
  pointsPlanned: 20,
  status: "completed",
};
const GOAL: SprintGoal = {
  ...blankGoal("s1"),
  goal: "Win back churned teams",
  okrIds: [OKR.id],
  outcome: { met: "partly", decidedAt: "2026-10-25" },
};

/** Seeds the browser store and the server rows with the same data. */
function seed({ okrs = [] as Okr[], goals = [] as SprintGoal[], sprints = [] as Sprint[] } = {}) {
  useWorkspaceStore.setState({ okrs, sprintGoals: goals, sprints });
  for (const o of okrs) rows.set(`workspace:okr/${o.id}`, o);
  for (const g of goals) rows.set(`workspace:sprintGoal/${g.id}`, g);
  for (const s of sprints) rows.set(`workspace:sprint/${s.id}`, s);
}

const storedKr = (okrId: string, krId: string): KeyResult | undefined =>
  (useWorkspaceStore.getState().okrs ?? [])
    .find((o) => o.id === okrId)
    ?.keyResults.find((k) => k.id === krId);

const serverKr = (okrId: string, krId: string): KeyResult | undefined =>
  (rows.get(`workspace:okr/${okrId}`) as Okr | undefined)?.keyResults.find((k) => k.id === krId);

beforeEach(() => {
  rows.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  seed();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tool.okrs — registration", () => {
  it("list_state read; check_in and update_key_result write + mcpHandler + no confirm", () => {
    expect(registry.get("tool.okrs.list_state")?.category).toBe("read");
    for (const verb of ["check_in", "update_key_result"]) {
      const a = registry.get(`tool.okrs.${verb}`);
      expect(a?.category, verb).toBe("write");
      expect(a?.mcpHandler, verb).toBeTypeOf("function");
      expect(a?.requiresConfirmation, verb).toBe(false);
    }
  });

  it("advertises every check_in param to MCP (the day's refinement converts)", () => {
    const json = zodToJsonSchema(registry.get("tool.okrs.check_in")!.paramsSchema);
    expect(Object.keys(json.properties as object).sort()).toEqual(
      ["confidence", "date", "keyResultId", "note", "okrId", "value"].sort()
    );
    expect(json.required).toEqual(["okrId", "keyResultId", "value"]);
  });
});

describe("tool.okrs.list_state", () => {
  it("is zeroed when empty", async () => {
    const r = await call<{ total: number; overallProgressPct: number; items: unknown[] }>(
      "list_state"
    );
    expect(r).toEqual({
      total: 0,
      overallProgressPct: 0,
      measuredObjectives: 0,
      measuredProgressPct: null,
      items: [],
    });
  });

  it("measures only objectives with a key result, as the page's headline does (both transports)", async () => {
    // o1 at 50%; o2 has no key result: overall 25 counts it as 0, measured reads 50.
    seed({ okrs: [okr("o1", [{ id: "k1", target: 100, current: 50 }]), okr("o2", [])] });
    for (const read of [call, callMcp]) {
      const r = await read<{
        overallProgressPct: number;
        measuredObjectives: number;
        measuredProgressPct: number | null;
      }>("list_state");
      expect(r).toMatchObject({
        overallProgressPct: 25,
        measuredObjectives: 1,
        measuredProgressPct: 50,
      });
    }
    seed({ okrs: [okr("o3", [])] });
    expect(await call("list_state")).toMatchObject({
      measuredObjectives: 0,
      measuredProgressPct: null,
    });
  });

  it("computes per-OKR and overall progress", async () => {
    // OKR1: KRs at 50% and 100% → 75%. OKR2: KR at 50/100=50% → 50%. overall 63 (round).
    seed({
      okrs: [
        okr("o1", [
          { id: "k1", target: 100, current: 50 },
          { id: "k2", target: 10, current: 10 },
        ]),
        okr("o2", [{ id: "k3", target: 100, current: 50 }]),
      ],
    });
    const r = await call<{
      total: number;
      overallProgressPct: number;
      items: { id: string; progressPct: number }[];
    }>("list_state");
    expect(r.total).toBe(2);
    expect(r.items.find((i) => i.id === "o1")!.progressPct).toBe(75);
    expect(r.items.find((i) => i.id === "o2")!.progressPct).toBe(50);
    expect(r.overallProgressPct).toBe(63); // round((0.75 + 0.5) / 2 × 100)
  });

  it("clamps over-attainment to 100% per key result", async () => {
    seed({ okrs: [okr("o1", [{ id: "k1", target: 10, current: 50 }])] });
    const r = await call<{ items: { progressPct: number }[] }>("list_state");
    expect(r.items[0].progressPct).toBe(100);
  });

  it("reads each objective and key result through lib/okrs", async () => {
    seed({ okrs: [OKR, LEGACY_OKR], goals: [GOAL], sprints: [SPRINT] });
    type Item = {
      id: string;
      quarter: string;
      owner: string | null;
      progressPct: number;
      confidence: number | null;
      verdict: string;
      confidenceTrend: unknown;
      progressTrend: unknown;
      linkedSprintGoals: unknown;
      keyResults: Record<string, unknown>[];
    };
    const r = await call<{ total: number; overallProgressPct: number; items: Item[] }>(
      "list_state"
    );
    expect(r.overallProgressPct).toBe(Math.round(overallProgress([OKR, LEGACY_OKR]) * 100));
    const [a, b] = r.items;
    expect(a).toMatchObject({
      id: OKR.id,
      quarter: "2026 Q4",
      owner: "Sam",
      progressPct: objectivePercent(OKR),
      confidence: objectiveConfidence(OKR),
      verdict: okrVerdict(OKR, NOW),
      confidenceTrend: confidenceTrend(OKR),
      linkedSprintGoals: sprintGoalsFor(OKR.id, [GOAL], [SPRINT]),
    });
    // lib/okrs progressTrend, as the page's chart plots it: churn checked in
    // at 19, 18 and 17 (22 → 15), NPS never checked in, at 31 of 20 → 40 every day.
    expect(a.progressTrend).toEqual(
      progressTrend(OKR).map((p) => ({
        date: p.date,
        progressPct: Math.round(p.progress * 100),
        measured: p.measured,
      }))
    );
    expect(a.progressTrend).toEqual([
      { date: "2026-10-01", progressPct: 49, measured: 1 },
      { date: "2026-10-02", progressPct: 56, measured: 1 },
      { date: "2026-10-03", progressPct: 63, measured: 1 },
    ]);
    // Churn's current (18) was set without a check-in, as workspace.okr.update
    // could before it held current to the newest check-in (a row stored
    // then), so the trend's last point (its newest check-in, 17) isn't the
    // headline; the description says the last point is progressPct only
    // while current mirrors the newest check-in.
    expect(a.progressPct).toBe(56);
    expect(a.linkedSprintGoals).toEqual([
      {
        goalId: GOAL.id,
        sprintId: "s1",
        sprintName: "Sprint 14",
        goal: "Win back churned teams",
        met: "partly",
      },
    ]);
    expect(a.keyResults[0]).toEqual({
      id: "kr_churn",
      title: "Monthly churn",
      description: "Logo churn, all plans",
      unit: "%",
      baseline: 22,
      direction: "decrease",
      target: 15,
      current: 18,
      progressPct: krPercent(OKR.keyResults[0]),
      progressText: "18% (from 22%, target 15%)",
      confidence: 6,
      confidenceBand: "at-risk",
      lastCheckIn: { id: "ci_3", date: "2026-10-03", value: 17, confidence: null, note: null },
      daysSinceCheckIn: 31,
      checkInCount: 3,
    });
    expect(a.keyResults[1]).toMatchObject({ confidence: null, lastCheckIn: null, checkInCount: 0 });
    // A row from before Phase 8: "Q4 2026" normalised, no baseline, no owner.
    expect(b).toMatchObject({
      quarter: "2026 Q4",
      owner: null,
      progressPct: 40,
      progressTrend: [],
    });
    expect(b.keyResults[0]).toMatchObject({ baseline: null, direction: "increase", confidence: 5 });
  });

  it("describes the progress trend's two conditional rules", () => {
    const text = registry.get("tool.okrs.list_state")!.description;
    expect(text).toContain("at its baseline before its first (0% with no baseline)");
    expect(text).toContain(
      "the last point is progressPct while each key result's current is its newest check-in's value"
    );
  });

  it("leaves example rows out", async () => {
    seed({ okrs: [OKR, { ...OKR, id: exampleId("okr-1") }] });
    const r = await call<{ total: number; items: { id: string }[] }>("list_state");
    expect(r.total).toBe(1);
    expect(r.items.map((i) => i.id)).toEqual([OKR.id]);
  });

  it("returns the same over MCP as in the browser", async () => {
    seed({ okrs: [OKR, LEGACY_OKR], goals: [GOAL], sprints: [SPRINT] });
    expect(await callMcp("list_state")).toEqual(await call("list_state"));
  });
});

describe("tool.okrs.check_in", () => {
  const start = (): Okr => ({
    id: "o1",
    objective: "Grow",
    quarter: "2026 Q4",
    keyResults: [
      { id: "k1", title: "Sign-ups", baseline: 0, target: 100, current: 0, checkIns: [] },
    ],
  });

  it("records a dated check-in and mirrors current and confidence from it", async () => {
    seed({ okrs: [start()] });
    const r = await call<Record<string, unknown>>("check_in", {
      okrId: "o1",
      keyResultId: "k1",
      value: 40,
      confidence: 7,
      date: "2026-10-30",
      note: "  Launch week  ",
    });
    expect(r).toMatchObject({
      recorded: true,
      date: "2026-10-30",
      current: 40,
      confidence: 7,
      keyResultProgressPct: 40,
      progressPct: 40,
    });
    const kr = storedKr("o1", "k1")!;
    expect(kr.current).toBe(40);
    expect(kr.confidence).toBe(7);
    expect(kr.checkIns).toEqual([
      { id: r.checkInId, date: "2026-10-30", value: 40, confidence: 7, note: "Launch week" },
    ]);
    expect(r.checkInId).toMatch(/^ci_/);
  });

  it("defaults to today, and files a backdated one without moving current", async () => {
    seed({ okrs: [start()] });
    const today = await call<{ date: string }>("check_in", {
      okrId: "o1",
      keyResultId: "k1",
      value: 60,
    });
    expect(today.date).toBe("2026-11-03");
    const back = await call<Record<string, unknown>>("check_in", {
      okrId: "o1",
      keyResultId: "k1",
      value: 20,
      confidence: 4,
      date: "2026-10-10",
    });
    expect(back).toMatchObject({ recorded: true, current: 60, confidence: 4 });
    expect(storedKr("o1", "k1")!.checkIns!.map((c) => c.date)).toEqual([
      "2026-10-10",
      "2026-11-03",
    ]);
  });

  it("says when a backdated first check-in rolls a typed value back, on both paths", async () => {
    seed({ okrs: [LEGACY_OKR] });
    const params = { okrId: LEGACY_OKR.id, keyResultId: "kr_a", value: 20, date: "2026-09-15" };
    const back = await call<Record<string, unknown>>("check_in", params);
    expect(back).toMatchObject({
      recorded: true,
      current: 20,
      replacedUndated: {
        current: 40,
        confidence: null,
        message:
          "A key result's first check-in becomes its current reading whatever its date, so this one (2026-09-15) replaced the undated current 40 with 20. If the old value was newer, check it in for today.",
      },
    });
    // The MCP path reads the same from the server rows.
    const mcp = await callMcp<Record<string, unknown>>("check_in", params);
    expect({ ...mcp, checkInId: back.checkInId }).toEqual(back);
    // Today's reading after it replaces nothing undated.
    expect(
      await call("check_in", { okrId: LEGACY_OKR.id, keyResultId: "kr_a", value: 40 })
    ).toMatchObject({ recorded: true, current: 40, replacedUndated: null });
  });

  it("refuses a future day, an unknown key result, and one older than a full history", async () => {
    const full: Okr = {
      ...start(),
      keyResults: [{ ...start().keyResults[0], checkIns: FULL_CHECK_INS, current: 51 }],
    };
    seed({ okrs: [full] });
    expect(
      await call("check_in", { okrId: "o1", keyResultId: "k1", value: 1, date: "2026-11-04" })
    ).toMatchObject({ recorded: false, reason: "future_day" });
    expect(await call("check_in", { okrId: "nope", keyResultId: "k1", value: 1 })).toMatchObject({
      recorded: false,
      reason: "not_found",
    });
    expect(await call("check_in", { okrId: "o1", keyResultId: "nope", value: 1 })).toMatchObject({
      recorded: false,
      reason: "not_found",
    });
    expect(
      await call("check_in", { okrId: "o1", keyResultId: "k1", value: 1, date: "2026-09-01" })
    ).toMatchObject({ recorded: false, reason: "too_old" });
    expect(storedKr("o1", "k1")!.checkIns).toEqual(FULL_CHECK_INS);
  });

  it("takes only a real day and a 0-10 confidence", () => {
    const schema = registry.get("tool.okrs.check_in")!.paramsSchema;
    const ok = { okrId: "o1", keyResultId: "k1", value: 1 };
    expect(schema.safeParse({ ...ok, date: "2026-02-30" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, date: "3 Nov" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, confidence: 11 }).success).toBe(false);
    expect(schema.safeParse({ ...ok, value: Infinity }).success).toBe(false);
    expect(schema.safeParse({ ...ok, confidence: 0, date: "2026-11-03" }).success).toBe(true);
  });

  it("over MCP takes the day after the server's, and defaults to a newer check-in's day", async () => {
    seed({ okrs: [start()] });
    const ahead = await callMcp<Record<string, unknown>>("check_in", {
      okrId: "o1",
      keyResultId: "k1",
      value: 30,
      date: "2026-11-04",
    });
    expect(ahead).toMatchObject({ recorded: true, date: "2026-11-04", current: 30 });
    // The server's today is behind the user's newest check-in: the default
    // takes that day, so the update doesn't file as backdated.
    const next = await callMcp<Record<string, unknown>>("check_in", {
      okrId: "o1",
      keyResultId: "k1",
      value: 35,
    });
    expect(next).toMatchObject({ recorded: true, date: "2026-11-04", current: 35 });
    expect(serverKr("o1", "k1")!.checkIns!.map((c) => c.value)).toEqual([30, 35]);
    expect(
      await callMcp("check_in", { okrId: "o1", keyResultId: "k1", value: 1, date: "2026-11-05" })
    ).toMatchObject({ recorded: false, reason: "future_day" });
    // The browser store is untouched by the MCP path.
    expect(storedKr("o1", "k1")!.checkIns).toEqual([]);
  });
});

describe("tool.okrs.update_key_result", () => {
  it("sets a key result's current by recording a check-in", async () => {
    seed({ okrs: [okr("o1", [{ id: "k1", target: 100, current: 0 }])] });
    const r = await call<{ updated: boolean; progressPct: number; checkInId: string }>(
      "update_key_result",
      { okrId: "o1", keyResultId: "k1", current: 80 }
    );
    expect(r).toMatchObject({ updated: true, progressPct: 80, current: 80, replacedUndated: null });
    const kr = storedKr("o1", "k1")!;
    expect(kr.current).toBe(80);
    expect(kr.checkIns).toEqual([{ id: r.checkInId, date: "2026-11-03", value: 80 }]);
  });

  it("passes check_in's word on a backdated first check-in through", async () => {
    seed({ okrs: [LEGACY_OKR] });
    const r = await call("update_key_result", {
      okrId: LEGACY_OKR.id,
      keyResultId: "kr_a",
      current: 20,
      confidence: 3,
      date: "2026-09-15",
    });
    expect(r).toMatchObject({
      updated: true,
      current: 20,
      replacedUndated: {
        current: 40,
        confidence: 5,
        message: expect.stringContaining(
          "replaced the undated current 40 with 20 and the undated confidence 5 with 3. If the old values were newer, check them in"
        ),
      },
    });
  });

  it("returns {updated:false} for unknown okr or key result", async () => {
    seed({ okrs: [okr("o1", [{ id: "k1", target: 100, current: 0 }])] });
    expect(
      await call("update_key_result", { okrId: "nope", keyResultId: "k1", current: 1 })
    ).toMatchObject({ updated: false, reason: "not_found" });
    expect(
      await call("update_key_result", { okrId: "o1", keyResultId: "nope", current: 1 })
    ).toMatchObject({ updated: false, reason: "not_found" });
  });

  it("writes the same check-in over MCP", async () => {
    seed({ okrs: [okr("o1", [{ id: "k1", target: 100, current: 0 }])] });
    const r = await callMcp<{ updated: boolean; progressPct: number }>("update_key_result", {
      okrId: "o1",
      keyResultId: "k1",
      current: 25,
      confidence: 6,
    });
    expect(r).toMatchObject({ updated: true, progressPct: 25 });
    expect(serverKr("o1", "k1")).toMatchObject({ current: 25, confidence: 6 });
    expect(serverKr("o1", "k1")!.checkIns).toHaveLength(1);
  });
});

describe("tool.okrs.remove_check_in", () => {
  const churn = () => OKR.keyResults[0];
  const ids = () => churn().checkIns!.map((c) => c.id);

  it("is a confirmed write on both transports", () => {
    const a = registry.get("tool.okrs.remove_check_in");
    expect(a?.category).toBe("write");
    expect(a?.requiresConfirmation).toBe(true);
    expect(a?.mcpHandler).toBeTypeOf("function");
  });

  it("deletes one check-in and re-mirrors from the rest, as the page does", async () => {
    seed({ okrs: [OKR] });
    const newest = ids()[2];
    const r = await call("remove_check_in", {
      okrId: OKR.id,
      keyResultId: "kr_churn",
      checkInId: newest,
    });
    const expected = withoutCheckIn(churn(), newest);
    expect(storedKr(OKR.id, "kr_churn")).toEqual(expected);
    expect(r).toEqual({
      removed: true,
      current: expected.current,
      confidence: 6,
      keyResultProgressPct: krPercent(expected),
      progressPct: objectivePercent({ ...OKR, keyResults: [expected, OKR.keyResults[1]] }),
      checkInCount: 2,
    });
  });

  it("goes back to the baseline once the last check-in goes, over MCP too", async () => {
    const one: Okr = {
      ...OKR,
      keyResults: [{ ...churn(), checkIns: [churn().checkIns![0]], current: 19 }],
    };
    seed({ okrs: [one] });
    const r = await callMcp("remove_check_in", {
      okrId: OKR.id,
      keyResultId: "kr_churn",
      checkInId: ids()[0],
    });
    expect(r).toMatchObject({ removed: true, current: 22, checkInCount: 0 });
    expect(serverKr(OKR.id, "kr_churn")).toMatchObject({ current: 22, checkIns: [] });
    // The browser store is untouched by the MCP path.
    expect(storedKr(OKR.id, "kr_churn")!.checkIns).toHaveLength(1);
  });

  it("refuses an unknown objective, key result or check-in", async () => {
    seed({ okrs: [OKR] });
    for (const p of [
      { okrId: "nope", keyResultId: "kr_churn", checkInId: ids()[0] },
      { okrId: OKR.id, keyResultId: "nope", checkInId: ids()[0] },
      { okrId: OKR.id, keyResultId: "kr_churn", checkInId: "nope" },
    ]) {
      expect(await call("remove_check_in", p)).toMatchObject({
        removed: false,
        reason: "not_found",
      });
    }
    expect(storedKr(OKR.id, "kr_churn")).toEqual(churn());
  });
});
