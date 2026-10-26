import { describe, expect, it } from "vitest";
import {
  COST_OF_DELAY,
  EISENHOWER,
  HUB_METHOD_IDS,
  ICE,
  KANO,
  METHODS,
  MOSCOW,
  RICE,
  VALUE_EFFORT,
  WSJF,
  method,
  methodFor,
  methodForTool,
} from "@/lib/prioritization/methods";
import { REACH_PER_QUARTER, riceScore } from "@/lib/prioritization/methods/rice";
import { columnsWithoutOne, fibonacciAtOrAbove } from "@/lib/prioritization/methods/wsjf";
import { veQuadrant } from "@/lib/prioritization/methods/value-effort";
import {
  KANO_TABLE,
  countsFromJoint,
  kanoCategory,
  kanoCoefficients,
  kanoCountFields,
  readKano,
} from "@/lib/prioritization/methods/kano";
import { cd3, latestStart } from "@/lib/prioritization/methods/cost-of-delay";
import { dueText, eisenhowerQuadrant, urgency } from "@/lib/prioritization/methods/eisenhower";
import { mustBudget, moscowEffort } from "@/lib/prioritization/methods/moscow";
import { tools } from "@/lib/constants/tools";

/**
 * The method registry: each method's evaluate at zero, unset, huge and
 * legacy values, its validation (blanks are errors, never defaults), and
 * its read / write of a row's fields (legacy keys read, unknown keys kept,
 * derived values never stored).
 */

const score = (m: (typeof METHODS)[number], v: Record<string, number | string | undefined>) =>
  m.evaluate(v).score;

describe("the registry", () => {
  it("lists the hub's seven methods in order, then Eisenhower, each at its tool's path", () => {
    expect(METHODS.map((m) => m.id)).toEqual([...HUB_METHOD_IDS, "eisenhower"]);
    for (const m of METHODS) {
      expect(
        tools.find((t) => t.id === m.toolId),
        m.id
      ).toBeDefined();
      expect(methodForTool(m.toolId)).toBe(m);
      expect(methodFor(m.id)).toBe(m);
      expect(method(m.id)).toBe(m);
    }
    expect(methodFor("hundred-dollar")).toBeUndefined();
    expect(METHODS.filter((m) => m.embedded).map((m) => m.id)).toEqual([
      "moscow",
      "wsjf",
      "rice",
      "value-effort",
    ]);
  });

  it("scores nothing it isn't given: every method is Not scored with no inputs", () => {
    for (const m of METHODS) {
      const r = m.evaluate({});
      expect(r.score, m.id).toBeNull();
      expect(r.sortKey, m.id).toBeNull();
      expect(r.bucket, m.id).toBeNull();
      expect(r.missing.length, m.id).toBeGreaterThan(0);
    }
  });

  it("refuses a blank draft with a message per missing input, never a default", () => {
    for (const m of METHODS) {
      if (m.id === "value-effort") continue; // both blank is "Not placed yet", by design
      const v = m.validate({});
      expect(v.ok, m.id).toBe(false);
      if (!v.ok)
        expect(Object.values(v.errors).every((e) => typeof e === "string" && e.length > 3)).toBe(
          true
        );
    }
    expect(VALUE_EFFORT.validate({}).ok).toBe(true);
  });

  it("gives every input a label, a hint and a missing message", () => {
    for (const m of METHODS) {
      for (const input of m.inputs) {
        expect(input.label, `${m.id}.${input.key}`).toBeTruthy();
        expect(input.hint, `${m.id}.${input.key}`).toBeTruthy();
        expect(input.missing, `${m.id}.${input.key}`).toBeTruthy();
      }
    }
  });
});

describe("RICE", () => {
  const full = { reach: 1000, reachPeriod: "quarter", impact: 2, confidence: 80, effort: 2 };

  it("is reach per quarter × impact × confidence ÷ effort, unrounded", () => {
    expect(score(RICE, full)).toBe(800);
    expect(score(RICE, { ...full, effort: 3 })).toBeCloseTo(533.333333, 5);
    expect(RICE.format(533.3333)).toBe("533.3");
  });

  it("normalises reach to per quarter, so periods compare", () => {
    expect(REACH_PER_QUARTER).toEqual({ week: 13, month: 3, quarter: 1, year: 0.25 });
    expect(score(RICE, { ...full, reach: 1000, reachPeriod: "month" })).toBe(2400);
    expect(score(RICE, { ...full, reach: 100, reachPeriod: "week" })).toBe(1040);
    expect(score(RICE, { ...full, reach: 4000, reachPeriod: "year" })).toBe(800);
    // A row without a period counts per quarter, what Reach always meant.
    expect(RICE.read({ reach: 10 }).reachPeriod).toBe("quarter");
  });

  it("is Not scored at an effort of 0 or none, and scores a legacy effort under 0.5 as 0.5", () => {
    expect(RICE.evaluate({ ...full, effort: 0 })).toMatchObject({
      score: null,
      missing: ["effort"],
    });
    expect(RICE.evaluate({ ...full, effort: undefined }).score).toBeNull();
    const low = RICE.evaluate({ ...full, effort: 0.25 });
    expect(low.score).toBe(3200); // 1,600 ÷ 0.5, not ÷ 0.25 (6,400)
    expect(low.warnings[0]).toMatch(/below the 0.5 minimum/);
    expect(low.extra?.effortBelowMinimum).toBe(true);
  });

  it("refuses an effort under 0.5 in a form, and blank inputs", () => {
    const v = RICE.validate({ ...full, effort: 0.25 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.effort).toBe("Effort is at least 0.5 person-months.");
    const blank = RICE.validate({ reachPeriod: "quarter" });
    expect(blank.ok).toBe(false);
    if (!blank.ok) {
      expect(Object.keys(blank.errors).sort()).toEqual(["confidence", "effort", "impact", "reach"]);
    }
    expect(RICE.validate(full).ok).toBe(true);
  });

  it("keeps zero, huge and exact custom values as they are", () => {
    expect(score(RICE, { ...full, reach: 0 })).toBe(0);
    expect(score(RICE, { ...full, reach: 1e9, effort: 0.5 })).toBe(3.2e9);
    expect(score(RICE, { ...full, impact: 1.5 })).toBe(600);
    expect(score(RICE, { ...full, confidence: 150 })).toBe(1000); // a percentage tops at 100
    expect(riceScore({ ...full, reachPeriod: "quarter" } as never)).toBe(800);
  });

  it("reads the agent's old confidencePct and writes back to the key a row uses", () => {
    const legacy = { reach: 100, impact: 1, confidencePct: 50, effort: 1, note: "keep" };
    expect(RICE.read(legacy).confidence).toBe(50);
    expect(RICE.write(legacy, { ...RICE.read(legacy), confidence: 80 })).toEqual({
      reach: 100,
      reachPeriod: "quarter",
      impact: 1,
      confidencePct: 80,
      effort: 1,
      note: "keep",
    });
    expect(RICE.write(undefined, full)).toMatchObject({ confidence: 80 });
  });

  it("maps to the backlog item's exact values (no impact snapping)", () => {
    expect(RICE.toBacklog!({ ...full, impact: 1.5 })).toEqual({
      reach: 1000,
      reachPeriod: "quarter",
      impact: 1.5,
      confidence: 80,
      effort: 2,
    });
  });
});

describe("WSJF", () => {
  const full = { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 4 };

  it("is (BV + TC + RR) ÷ job size, on the Fibonacci scale to 20 with no clamp", () => {
    expect(score(WSJF, full)).toBe(4);
    expect(score(WSJF, { businessValue: 20, timeCriticality: 20, rrOe: 13, jobSize: 1 })).toBe(53);
    expect(WSJF.format(4)).toBe("4.00");
  });

  it("is Not scored at a job size of 0, and floors a legacy 0 < size < 1 at 1", () => {
    expect(WSJF.evaluate({ ...full, jobSize: 0 })).toMatchObject({
      score: null,
      missing: ["jobSize"],
    });
    const small = WSJF.evaluate({ ...full, jobSize: 0.5 });
    expect(small.score).toBe(16);
    expect(small.warnings[0]).toMatch(/counts as 1/);
  });

  it("keeps an off-scale value (Custom) and a zero value part", () => {
    expect(score(WSJF, { ...full, businessValue: 7 })).toBe(3.75);
    expect(score(WSJF, { ...full, businessValue: 0 })).toBe(2);
    expect(WSJF.validate({ ...full, businessValue: 7 }).ok).toBe(true);
    expect(WSJF.validate({ ...full, jobSize: 0 }).ok).toBe(false);
  });

  it("maps rrOe to the item's riskReduction", () => {
    expect(WSJF.toBacklog!(full)).toEqual({
      businessValue: 8,
      timeCriticality: 5,
      riskReduction: 3,
      jobSize: 4,
    });
    expect(
      WSJF.fromBacklog!({
        id: "b",
        name: "B",
        businessValue: 8,
        timeCriticality: 5,
        riskReduction: 3,
        jobSize: 4,
        updatedAt: "x",
      })
    ).toEqual(full);
  });

  it("hints at a column without a 1 once it has two scored values", () => {
    expect(
      columnsWithoutOne([
        { businessValue: 1, timeCriticality: 3, rrOe: 2, jobSize: 1 },
        { businessValue: 5, timeCriticality: 8, rrOe: 1 },
        { businessValue: 2 },
      ])
    ).toEqual(["timeCriticality"]);
  });

  it("maps the old 1–10 value onto the Fibonacci step at or above it", () => {
    const mapped = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => fibonacciAtOrAbove(n));
    expect(mapped).toEqual([1, 2, 3, 5, 5, 8, 8, 8, 13, 13]);
    expect(fibonacciAtOrAbove(13)).toBe(13);
    expect(fibonacciAtOrAbove(40)).toBe(20);
    expect(fibonacciAtOrAbove(undefined)).toBeUndefined();
  });
});

describe("ICE", () => {
  it("is impact × confidence × ease, each held to 1–10", () => {
    expect(score(ICE, { impact: 8, confidence: 5, ease: 2 })).toBe(80);
    expect(score(ICE, { impact: 10, confidence: 10, ease: 10 })).toBe(1000);
    expect(score(ICE, { impact: 0, confidence: 5, ease: 2 })).toBe(10); // a legacy 0 counts as 1
    expect(score(ICE, { impact: 99, confidence: 1, ease: 1 })).toBe(10);
    expect(score(ICE, { impact: 6.5, confidence: 2, ease: 2 })).toBe(26);
  });

  it("is Not scored with a score missing, and the form refuses out-of-range values", () => {
    expect(ICE.evaluate({ impact: 8, confidence: 5 }).missing).toEqual(["ease"]);
    const v = ICE.validate({ impact: 11, confidence: 5, ease: 2 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.impact).toBe("Impact runs from 1 to 10.");
  });
});

describe("MoSCoW", () => {
  it("scores the bucket 4 / 3 / 2 / 1 and has no default bucket", () => {
    expect(MOSCOW.evaluate({ bucket: "must" })).toMatchObject({ score: 4, bucket: "must" });
    expect(score(MOSCOW, { bucket: "wont" })).toBe(1);
    expect(MOSCOW.evaluate({ bucket: "maybe" })).toMatchObject({ score: null, bucket: null });
    expect(MOSCOW.read({ bucket: "maybe" }).bucket).toBeUndefined();
    const v = MOSCOW.validate({});
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.bucket).toBe("Pick a bucket.");
  });

  it("budgets the Musts against Must + Should + Could, from 3 sized items", () => {
    const b = mustBudget([
      { bucket: "must", effort: 8 },
      { bucket: "should", effort: 3 },
      { bucket: "could", effort: 1 },
      { bucket: "wont", effort: 40 },
      { bucket: "must", effort: null },
    ]);
    expect(b).toMatchObject({ mustEffort: 8, plannedEffort: 12, sized: 3, unsized: 1, over: true });
    expect(b.share).toBeCloseTo(0.667, 3);
    expect(b.excess).toBeCloseTo(8 - 0.6 * 12, 6);
    expect(
      mustBudget([
        { bucket: "must", effort: 5 },
        { bucket: "could", effort: 5 },
      ]).share
    ).toBeNull();
    const at = mustBudget([
      { bucket: "must", effort: 6 },
      { bucket: "should", effort: 2 },
      { bucket: "could", effort: 2 },
    ]);
    expect(at).toMatchObject({ share: 0.6, over: false, excess: 0 });
  });

  it("takes a linked item's job size as the effort, else the row's own", () => {
    const item = { id: "b", name: "B", jobSize: 8, updatedAt: "x" };
    expect(moscowEffort({ effort: 3 }, item)).toBe(8);
    expect(moscowEffort({ effort: 3 })).toBe(3);
    expect(moscowEffort({})).toBeNull();
  });
});

describe("Value/Effort", () => {
  it("is high value at 8 or more (Fibonacci) and high effort at 6 or more", () => {
    expect(veQuadrant(8, 5)).toBe("quick_wins");
    expect(veQuadrant(8, 6)).toBe("big_bets");
    expect(veQuadrant(5, 5)).toBe("fill_ins");
    expect(veQuadrant(5, 6)).toBe("time_wasters");
    expect(veQuadrant(20, 1)).toBe("quick_wins");
    expect(veQuadrant(undefined, 3)).toBeNull();
    expect(veQuadrant(8, 0)).toBeNull();
  });

  it("sorts quadrant by quadrant in do-first order, by value ÷ effort within", () => {
    const qw = VALUE_EFFORT.evaluate({ value: 8, effort: 4 });
    const qw2 = VALUE_EFFORT.evaluate({ value: 13, effort: 2 });
    const bb = VALUE_EFFORT.evaluate({ value: 20, effort: 10 });
    const tw = VALUE_EFFORT.evaluate({ value: 1, effort: 10 });
    expect(qw).toMatchObject({ score: 2, bucket: "quick_wins" });
    expect(qw2.sortKey!).toBeGreaterThan(qw.sortKey!);
    expect(qw.sortKey!).toBeGreaterThan(bb.sortKey!);
    expect(bb.sortKey!).toBeGreaterThan(tw.sortKey!);
  });

  it("wants both or neither, never one alone", () => {
    expect(VALUE_EFFORT.validate({}).ok).toBe(true);
    expect(VALUE_EFFORT.validate({ value: 8, effort: 3 }).ok).toBe(true);
    const one = VALUE_EFFORT.validate({ value: 8 });
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.errors.effort).toMatch(/leave both empty/);
    expect(VALUE_EFFORT.validate({ value: 8, effort: 12 }).ok).toBe(false);
  });

  it("ignores a stored quadrant, reads the old 1–10 value, and writes neither back", () => {
    // An old agent row said quick_wins at (5, 5); the one rule says Fill-Ins.
    const legacy = { value: 7, effort: 3, quadrant: "quick_wins" };
    expect(VALUE_EFFORT.read(legacy)).toEqual({ value: 8, effort: 3 });
    expect(
      VALUE_EFFORT.evaluate(VALUE_EFFORT.read({ value: 5, effort: 5, quadrant: "Quick Wins" }))
        .bucket
    ).toBe("fill_ins");
    expect(VALUE_EFFORT.write(legacy, { value: 8, effort: 3 })).toEqual({
      businessValue: 8,
      effort: 3,
    });
    expect(VALUE_EFFORT.toBacklog!({ value: 13, effort: 3 })).toEqual({
      businessValue: 13,
      matrixEffort: 3,
    });
  });
});

describe("Kano", () => {
  it("uses the Kano evaluation table, Q included", () => {
    expect(KANO_TABLE.like.dislike).toBe("O");
    expect(KANO_TABLE.like.neutral).toBe("A");
    expect(KANO_TABLE.neutral.dislike).toBe("M");
    expect(KANO_TABLE.like.like).toBe("Q");
    expect(KANO_TABLE.dislike.dislike).toBe("Q");
    expect(KANO_TABLE.dislike.like).toBe("R");
    expect(KANO.evaluate({ functional: "like", dysfunctional: "like" })).toMatchObject({
      bucket: "questionable",
      score: 0,
    });
  });

  it("takes the most common class, ties M > O > A > I > R > Q, from 3 answers", () => {
    expect(kanoCategory({ A: 2, O: 2, M: 2, I: 0, R: 0, Q: 0 })).toBe("must-be");
    expect(kanoCategory({ A: 3, O: 3, M: 0, I: 1, R: 0, Q: 0 })).toBe("performance");
    expect(kanoCategory({ A: 0, O: 0, M: 0, I: 0, R: 0, Q: 0 })).toBeNull();
    const two = KANO.evaluate({ kanoA: 2, kanoO: 0, kanoM: 0, kanoI: 0, kanoR: 0, kanoQ: 0 });
    expect(two).toMatchObject({ score: null, missing: ["answers"] });
    const three = KANO.evaluate({ kanoA: 2, kanoO: 1, kanoM: 0, kanoI: 0, kanoR: 0, kanoQ: 0 });
    expect(three).toMatchObject({ bucket: "attractive", score: 3 });
  });

  it("computes Better and Worse over A + O + M + I", () => {
    expect(kanoCoefficients({ A: 4, O: 2, M: 1, I: 1, R: 3, Q: 1 })).toEqual({
      better: 0.75,
      worse: -0.375,
      n: 8,
    });
    expect(kanoCoefficients({ A: 0, O: 0, M: 0, I: 0, R: 2, Q: 1 })).toBeNull();
  });

  it("ranks must-be first for Decide order", () => {
    const rank = (c: string) =>
      KANO.evaluate({
        ...Object.fromEntries(
          ["A", "O", "M", "I", "R", "Q"].map((k) => [`kano${k}`, k === c ? 3 : 0])
        ),
      }).score;
    expect(["M", "O", "A", "I", "R", "Q"].map(rank)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("reads counts first, then a pair, then a hand-picked category (never Performance by default)", () => {
    expect(
      readKano({ category: "attractive", functional: "like", dysfunctional: "dislike" }).source
    ).toBe("pair");
    expect(KANO.evaluate(KANO.read({ category: "attractive" }))).toMatchObject({
      bucket: "attractive",
      warnings: ["Picked by hand: add answers to derive the category."],
    });
    expect(KANO.evaluate(KANO.read({ category: "bogus" })).bucket).toBeNull();
    expect(KANO.evaluate(KANO.read({ satIfPresent: 4, dissatIfAbsent: 2 })).score).toBeNull();
  });

  it("folds a 5×5 joint into class counts and writes them over earlier ones", () => {
    const joint = new Array(25).fill(0);
    joint[0 * 5 + 4] = 3; // like / dislike → O
    joint[2 * 5 + 4] = 1; // neutral / dislike → M
    joint[0] = 1; // like / like → Q
    const counts = countsFromJoint(joint)!;
    expect(counts).toEqual({ A: 0, O: 3, M: 1, I: 0, R: 0, Q: 1 });
    expect(countsFromJoint([1, 2])).toBeNull();
    const fields = kanoCountFields({ category: "attractive", note: "x" }, counts, {
      source: "room",
      roundId: "r1",
      at: "2026-10-26",
    });
    expect(fields).toEqual({
      note: "x",
      kanoA: 0,
      kanoO: 3,
      kanoM: 1,
      kanoI: 0,
      kanoR: 0,
      kanoQ: 1,
      kanoN: 5,
      kanoSource: "room",
      kanoRoundId: "r1",
      kanoAt: "2026-10-26",
    });
    expect(KANO.evaluate(KANO.read(fields))).toMatchObject({ bucket: "performance" });
  });

  it("accepts a pair or counts in a form, never half a pair", () => {
    expect(KANO.validate({ functional: "like", dysfunctional: "must" }).ok).toBe(true);
    expect(KANO.validate({ functional: "like" }).ok).toBe(false);
    expect(KANO.validate({ kanoA: 1 }).ok).toBe(true);
    expect(KANO.validate({ kanoA: 0, kanoO: 0 }).ok).toBe(false);
    expect(KANO.validate({ kanoA: 1.5 }).ok).toBe(false);
    expect(KANO.validate({}).ok).toBe(false);
  });
});

describe("Cost of Delay", () => {
  it("is CD3: cost per week ÷ duration, the duration at least half a week", () => {
    expect(cd3(5000, 2)).toBe(2500);
    expect(score(COST_OF_DELAY, { perWeekUsd: 5000, durationWeeks: 2, urgency: "standard" })).toBe(
      2500
    );
    expect(score(COST_OF_DELAY, { perWeekUsd: 0, durationWeeks: 2, urgency: "standard" })).toBe(0);
    expect(score(COST_OF_DELAY, { perWeekUsd: 1e9, durationWeeks: 0.5, urgency: "standard" })).toBe(
      2e9
    );
    const small = COST_OF_DELAY.evaluate({
      perWeekUsd: 1000,
      durationWeeks: 0.25,
      urgency: "standard",
    });
    expect(small.score).toBe(2000);
    expect(small.warnings[0]).toMatch(/counts as 0.5/);
  });

  it("reads a row from before CD3 as Not scored, keeping its old total for reference", () => {
    const legacy = { perWeekUsd: 2000, weeksDelayed: 6, totalCost: 12000 };
    const r = COST_OF_DELAY.evaluate(COST_OF_DELAY.read(legacy));
    expect(r).toMatchObject({ score: null, missing: ["durationWeeks"] });
    expect(r.extra?.totalCost).toBe(12000);
    expect(
      COST_OF_DELAY.write(legacy, { perWeekUsd: 2000, durationWeeks: 3, urgency: "standard" })
    ).toEqual({
      perWeekUsd: 2000,
      weeksDelayed: 6,
      totalCost: 12000,
      durationWeeks: 3,
      urgency: "standard",
    });
  });

  it("orders the lanes: expedite, fixed date by latest start, standard by CD3, intangible", () => {
    const e = (v: Record<string, string | number>) => COST_OF_DELAY.evaluate(v);
    const list = [
      { id: "intangible", r: e({ perWeekUsd: 9000, durationWeeks: 1, urgency: "intangible" }) },
      { id: "std-low", r: e({ perWeekUsd: 1000, durationWeeks: 1, urgency: "standard" }) },
      {
        id: "fixed-late",
        r: e({ perWeekUsd: 10, durationWeeks: 1, urgency: "fixed_date", fixedDate: "2026-12-31" }),
      },
      { id: "std-high", r: e({ perWeekUsd: 5000, durationWeeks: 1, urgency: "standard" }) },
      { id: "expedite", r: e({ perWeekUsd: 1, durationWeeks: 9, urgency: "expedite" }) },
      {
        id: "fixed-early",
        r: e({ perWeekUsd: 10, durationWeeks: 4, urgency: "fixed_date", fixedDate: "2026-12-01" }),
      },
      { id: "no-lane", r: e({ perWeekUsd: 100, durationWeeks: 1 }) },
    ];
    list.sort((a, b) => COST_OF_DELAY.compare!(a.r, b.r));
    expect(list.map((x) => x.id)).toEqual([
      "expedite",
      "fixed-early",
      "fixed-late",
      "std-high",
      "std-low",
      "no-lane",
      "intangible",
    ]);
  });

  it("dates the latest start: the fixed date less the duration, in whole days", () => {
    expect(latestStart("2026-12-01", 4)).toBe("2026-11-03");
    expect(latestStart("2026-12-01", 0.5)).toBe("2026-11-27");
    expect(latestStart(undefined, 4)).toBeNull();
    const v = COST_OF_DELAY.validate({ perWeekUsd: 10, durationWeeks: 2, urgency: "fixed_date" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.fixedDate).toBe("Enter the date it must land by.");
  });
});

describe("Eisenhower", () => {
  const today = "2026-10-26";

  it("derives the quadrant from the two answers, and none without both", () => {
    const q = (urgent?: string, important?: string) =>
      eisenhowerQuadrant({ urgent, important }, today);
    expect([
      q("true", "true"),
      q("false", "true"),
      q("true", "false"),
      q("false", "false"),
    ]).toEqual(["do", "schedule", "delegate", "delete"]);
    expect(q(undefined, "true")).toBeNull();
    expect(EISENHOWER.evaluate({ important: "true" }, { today }).missing).toEqual(["urgent"]);
  });

  it("counts a task due within two days (or overdue) as urgent, with the reason", () => {
    expect(urgency({ urgent: "false", dueAt: "2026-10-28" }, today)).toEqual({
      urgent: true,
      because: "due",
      daysToDue: 2,
    });
    expect(urgency({ dueAt: "2026-10-20" }, today)).toMatchObject({ urgent: true, because: "due" });
    expect(urgency({ urgent: "false", dueAt: "2026-10-29" }, today).urgent).toBe(false);
    expect(urgency({ urgent: "true", dueAt: "2026-10-27" }, today).because).toBe("toggle");
    expect(
      EISENHOWER.evaluate({ important: "true", dueAt: "2026-10-27" }, { today })
    ).toMatchObject({
      bucket: "do",
      score: 4,
      extra: { urgentBecause: "due", daysToDue: 1 },
    });
    expect([dueText(0), dueText(1), dueText(3), dueText(-1), dueText(-2)]).toEqual([
      "due today",
      "due tomorrow",
      "due in 3 days",
      "1 day overdue",
      "2 days overdue",
    ]);
  });

  it("maps a legacy hand-picked quadrant to the pair, and stores only the pair", () => {
    expect(EISENHOWER.read({ quadrant: "delegate" })).toMatchObject({
      urgent: "true",
      important: "false",
    });
    expect(EISENHOWER.read({ quadrant: "bogus" })).toMatchObject({
      urgent: undefined,
      important: undefined,
    });
    expect(
      EISENHOWER.write(
        { quadrant: "do", note: "x" },
        { urgent: "true", important: "true", delegateTo: " Sam " }
      )
    ).toEqual({ note: "x", urgent: "true", important: "true", delegateTo: "Sam" });
  });
});
