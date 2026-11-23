// @vitest-environment node
/**
 * The A/B Calculator's maths against published values: R's power.prop.test
 * for sample sizes, the z test, Wilson's and Newcombe's intervals (Newcombe
 * 1998), Katz's log interval for a ratio, and the chi-square split check;
 * then the page's own rules in lib/experiments/model: the forms, the
 * early-look rule and a saved test's reading.
 */

import { describe, expect, it } from "vitest";
import {
  SPLIT_FLAG_P,
  alphaOf,
  analysisPText,
  analyzeConversion,
  criticalZ,
  detectableEffect,
  intervalLevel,
  katzInterval,
  newcombeInterval,
  pText,
  perVariantSize,
  pointsText,
  pooledZ,
  resultSentence,
  runLength,
  sampleSizeConversion,
  splitCheck,
  wilsonInterval,
  type ConversionPlan,
} from "@/lib/experiments/ab";
import {
  NO_PLAN_NOTE,
  abTests,
  countedTests,
  countsDraftFrom,
  earlyLook,
  effectTable,
  emptyPlanDraft,
  planDraftFrom,
  planResult,
  readResult,
  testCounts,
  testForHypothesis,
  testSummary,
  validateCounts,
  validatePlan,
  withCounts,
} from "@/lib/experiments/model";
import type { AbTest } from "@/lib/stores/workspace-types";

const Z95 = 1.959963984540054;

const plan = (over: Partial<ConversionPlan> = {}): ConversionPlan => ({
  baseline: 0.1,
  mde: 0.2,
  mdeMode: "relative",
  confidence: 0.95,
  power: 0.8,
  sided: "two",
  ...over,
});

const close = (actual: number, expected: number, digits = 4) =>
  expect(actual).toBeCloseTo(expected, digits);

describe("sample size (R's power.prop.test)", () => {
  it("10% → 12% at 95% and 80% needs 3,840.85, so 3,841 a version", () => {
    close(sampleSizeConversion(plan()), 3840.85, 1);
    expect(perVariantSize(plan())).toBe(3841);
    // The same as an absolute change of 2 points.
    expect(perVariantSize(plan({ mde: 0.02, mdeMode: "absolute" }))).toBe(3841);
  });

  it("one-sided needs 3,026; 90% power 5,142", () => {
    expect(perVariantSize(plan({ sided: "one" }))).toBe(3026);
    expect(perVariantSize(plan({ power: 0.9 }))).toBe(5142);
  });

  it("50% → 75% at 90% power needs 76.7, so 77 (R's documented example)", () => {
    const p = plan({ baseline: 0.5, mde: 0.25, mdeMode: "absolute", power: 0.9 });
    close(sampleSizeConversion(p), 76.7, 1);
    expect(perVariantSize(p)).toBe(77);
  });

  it("refuses a treatment rate outside (0, 1), or no change", () => {
    expect(() => sampleSizeConversion(plan({ baseline: 0.9, mde: 0.2 }))).toThrow(RangeError);
    expect(() => sampleSizeConversion(plan({ baseline: 0 }))).toThrow(RangeError);
    expect(() => sampleSizeConversion(plan({ mde: 0 }))).toThrow(RangeError);
    expect(() =>
      sampleSizeConversion(plan({ baseline: 0.05, mde: -0.06, mdeMode: "absolute" }))
    ).toThrow(RangeError);
  });

  it("runs whole days at the daily traffic, then whole weeks", () => {
    expect(runLength(3841, 800)).toEqual({ days: 10, weeks: 2 });
    expect(runLength(3500, 1000)).toEqual({ days: 7, weeks: 1 });
    expect(runLength(3841, undefined)).toBeNull();
    expect(runLength(3841, 0)).toBeNull();
  });

  it("finds the smallest effect a sample can see: 3,841 a version from 10% is about 2 points", () => {
    const d = detectableEffect(0.1, 3841, plan())!;
    close(d, 0.02, 4);
    expect(d).toBeLessThanOrEqual(0.02);
    // Round trip: that effect needs at most the sample.
    expect(sampleSizeConversion(plan({ mde: d, mdeMode: "absolute" }))).toBeLessThanOrEqual(3841);
    expect(detectableEffect(0.1, 1, plan())).toBeNull();
    expect(detectableEffect(1, 3841, plan())).toBeNull();
  });
});

describe("the z test", () => {
  it("200/1000 against 250/1000 gives z 2.6774 and p 0.00742", () => {
    const a = { visitors: 1000, conversions: 200 };
    const b = { visitors: 1000, conversions: 250 };
    close(pooledZ(a, b), 2.6774, 4);
    const r = analyzeConversion(a, b, { confidence: 0.95, sided: "two" });
    close(r.p, 0.00742, 5);
    expect(r.significant).toBe(true);
  });

  it("100/1000 against 120/1000 gives p 0.1529: not significant", () => {
    const r = analyzeConversion(
      { visitors: 1000, conversions: 100 },
      { visitors: 1000, conversions: 120 },
      { confidence: 0.95, sided: "two" }
    );
    close(r.p, 0.1529, 4);
    expect(r.significant).toBe(false);
  });

  it("reads z 0 and p 1 when nobody, or everybody, converted", () => {
    const none = analyzeConversion(
      { visitors: 50, conversions: 0 },
      { visitors: 50, conversions: 0 },
      { confidence: 0.95, sided: "two" }
    );
    expect(none.z).toBe(0);
    expect(none.p).toBe(1);
    expect(none.lift).toBeNull();
    expect(none.liftInterval).toBeNull();
  });
});

describe("intervals", () => {
  it.each([
    [81, 263, 0.2553, 0.3662],
    [15, 148, 0.0624, 0.1605],
    [0, 20, 0, 0.1611],
    [1, 29, 0.0061, 0.1718],
  ])("Wilson: %i/%i gives %s to %s", (x, n, lo, hi) => {
    const [l, u] = wilsonInterval(x, n, Z95);
    close(l, lo);
    close(u, hi);
  });

  it.each([
    [56, 70, 48, 80, 0.0524, 0.3339],
    [9, 10, 3, 10, 0.1705, 0.809],
    [5, 56, 0, 29, -0.0381, 0.1926],
  ])("Newcombe: %i/%i − %i/%i gives %s to %s (Newcombe 1998)", (x1, n1, x2, n2, lo, hi) => {
    const [l, u] = newcombeInterval(
      { conversions: x1, visitors: n1 },
      { conversions: x2, visitors: n2 },
      Z95
    );
    close(l, lo);
    close(u, hi);
  });

  it("Katz: 250/1000 over 200/1000 is a ratio of 1.25, from 1.0609 to 1.4727", () => {
    const k = katzInterval(
      { visitors: 1000, conversions: 250 },
      { visitors: 1000, conversions: 200 },
      Z95
    )!;
    close(k.ratio, 1.25);
    close(k.interval[0], 1.0609);
    close(k.interval[1], 1.4727);
    expect(
      katzInterval({ visitors: 10, conversions: 0 }, { visitors: 10, conversions: 2 }, Z95)
    ).toBeNull();
  });
});

describe("the split check", () => {
  it("10,000 against 10,300 gives χ² 4.4335 and p 0.0352: not flagged", () => {
    const s = splitCheck({ visitors: 10000, conversions: 0 }, { visitors: 10300, conversions: 0 });
    close(s.chiSquare, 4.4335);
    close(s.p, 0.0352);
    expect(s.flagged).toBe(false);
  });

  it("10,000 against 10,600 gives p 2.9e-5: flagged", () => {
    const s = splitCheck({ visitors: 10000, conversions: 0 }, { visitors: 10600, conversions: 0 });
    expect(s.p).toBeCloseTo(2.9e-5, 6);
    expect(s.flagged).toBe(true);
  });
});

describe("the example: a shorter sign-up form", () => {
  const a = { visitors: 4020, conversions: 402 };
  const b = { visitors: 3980, conversions: 477 };
  const r = analyzeConversion(a, b, { confidence: 0.95, sided: "two" });

  it("reads z 2.8384, p 0.00453, the difference, the lift and the split", () => {
    close(r.z, 2.8384);
    close(r.p, 0.00453, 5);
    close(r.difference, 0.01985, 4);
    close(r.differenceInterval[0], 0.0061);
    close(r.differenceInterval[1], 0.0336);
    close(1 + (r.lift as number), 1.1985);
    close(1 + (r.liftInterval as readonly number[])[0], 1.0574);
    close(1 + (r.liftInterval as readonly number[])[1], 1.3584);
    close(r.split.p, 0.6547);
    expect(r.split.flagged).toBe(false);
    expect(r.significant).toBe(true);
    expect(r.level).toBe(0.95);
  });

  it("says it in fixed words, never as a chance that B is better", () => {
    expect(resultSentence(r)).toBe(
      "B converted better than A by 2.0 points (95% interval +0.6 to +3.4 points; p = 0.0045), significant at 95% confidence."
    );
    expect(resultSentence(r)).not.toMatch(/chance|probability|likely/i);
  });
});

describe("one-sided plans", () => {
  it("read the one-sided p for B better, with intervals two-sided at 1 − 2α", () => {
    const a = { visitors: 1000, conversions: 100 };
    const b = { visitors: 1000, conversions: 120 };
    const one = analyzeConversion(a, b, { confidence: 0.95, sided: "one" });
    const two = analyzeConversion(a, b, { confidence: 0.95, sided: "two" });
    close(one.p, two.p / 2, 10);
    expect(intervalLevel(0.95, "one")).toBeCloseTo(0.9, 12);
    expect(one.level).toBeCloseTo(0.9, 12);
    // The interval's lower end is above 0 exactly when the one-sided p is below α.
    expect(one.differenceInterval[0] > 0).toBe(one.p < 0.05);
    close(criticalZ(0.95, "one"), 1.6449);
  });

  it("words a one-sided miss as not shown better", () => {
    const r = analyzeConversion(
      { visitors: 1000, conversions: 120 },
      { visitors: 1000, conversions: 100 },
      { confidence: 0.95, sided: "one" }
    );
    expect(r.significant).toBe(false);
    expect(resultSentence(r)).toMatch(
      /^B isn't shown to convert better than A: −2\.0 points \(90% interval/
    );
    expect(resultSentence(r)).toContain("one-sided p = ");
  });

  it("words a two-sided loss and no difference", () => {
    const worse = analyzeConversion(
      { visitors: 1000, conversions: 250 },
      { visitors: 1000, conversions: 200 },
      { confidence: 0.95, sided: "two" }
    );
    expect(resultSentence(worse)).toMatch(/^B converted worse than A by 5\.0 points/);
    const same = analyzeConversion(
      { visitors: 1000, conversions: 100 },
      { visitors: 1000, conversions: 104 },
      { confidence: 0.95, sided: "two" }
    );
    expect(resultSentence(same)).toMatch(/^No clear difference between A and B: \+0\.4 points/);
    expect(resultSentence(same)).toContain("not significant at 95% confidence.");
  });
});

describe("in words", () => {
  it("writes points and p values as people read them", () => {
    expect(pointsText(0.0198)).toBe("+2.0");
    expect(pointsText(-0.013)).toBe("−1.3");
    expect(pointsText(0)).toBe("0.0");
    expect(pText(0.00453)).toBe("0.0045");
    expect(pText(0.4321)).toBe("0.43");
    expect(pText(0.00002)).toBe("< 0.0001");
  });

  it("gives a p next to α the digits that show which side of it p is", () => {
    const alpha = alphaOf(0.95);
    // Two digits would print both as 0.05, one significant and one not.
    expect(pText(0.0499)).toBe("0.05");
    expect(pText(0.0504)).toBe("0.05");
    expect(pText(0.0499, alpha)).toBe("0.0499");
    expect(pText(0.0504, alpha)).toBe("0.0504");
    expect(pText(0.04996, alpha)).toBe("0.04996");
    expect(pText(0.05, alpha)).toBe("< 0.05");
    expect(pText(0.0500001, alpha)).toBe("0.0500001");
    expect(pText(0.05000001, alpha)).toBe("≥ 0.05");
    // Away from the line, and at 90% and 99%, two digits as before.
    expect(pText(0.043, alpha)).toBe("0.043");
    expect(pText(0.0996, alphaOf(0.9))).toBe("0.0996");
    expect(pText(0.0101, alphaOf(0.99))).toBe("0.0101");
    expect(pText(0.00002, alpha)).toBe("< 0.0001");
    // The split check reads against its own line.
    expect(pText(0.000996, SPLIT_FLAG_P)).toBe("0.000996");

    const base = analyzeConversion(
      { visitors: 1000, conversions: 100 },
      { visitors: 1000, conversions: 125 },
      { confidence: 0.95, sided: "two" }
    );
    const won = { ...base, p: 0.0499, significant: true };
    const missed = { ...base, p: 0.0504, significant: false };
    expect(analysisPText(won)).toBe("0.0499");
    expect(resultSentence(won)).toContain("; p = 0.0499)");
    expect(resultSentence(won)).toMatch(/significant at 95% confidence\.$/);
    expect(resultSentence(missed)).toContain("; p = 0.0504)");
    expect(resultSentence(missed)).toMatch(/not significant at 95% confidence\.$/);
    expect(resultSentence({ ...base, p: 0.05, significant: true })).toContain("; p < 0.05)");
  });
});

describe("bad counts", () => {
  it("are refused", () => {
    const ok = { visitors: 10, conversions: 1 };
    const opts = { confidence: 0.95, sided: "two" as const };
    expect(() => analyzeConversion({ visitors: 0, conversions: 0 }, ok, opts)).toThrow(RangeError);
    expect(() => analyzeConversion(ok, { visitors: 5, conversions: 6 }, opts)).toThrow(RangeError);
    expect(() => analyzeConversion(ok, { visitors: 5.5, conversions: 1 }, opts)).toThrow(
      RangeError
    );
  });
});

/* ── lib/experiments/model ──────────────────────────────────────────── */

describe("the plan form", () => {
  it("stores percentages as fractions and reads them back", () => {
    const r = validatePlan({
      ...emptyPlanDraft(),
      baselinePct: "10",
      mde: "20",
      dailyTraffic: "800",
    });
    expect(r).toEqual({
      ok: true,
      values: {
        baseline: 0.1,
        mde: 0.2,
        mdeMode: "relative",
        confidence: 0.95,
        power: 0.8,
        sided: "two",
        dailyTraffic: 800,
      },
    });
    if (r.ok) {
      expect(planDraftFrom(r.values)).toEqual({
        ...emptyPlanDraft(),
        baselinePct: "10",
        mde: "20",
        dailyTraffic: "800",
      });
    }
  });

  it("refuses a blank or impossible plan, and a change past 100%", () => {
    const r = validatePlan(emptyPlanDraft());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.baselinePct).toBe("Enter the current conversion rate.");
      expect(r.errors.mde).toBe("Enter the smallest change worth finding.");
    }
    const past = validatePlan({ ...emptyPlanDraft(), baselinePct: "60", mde: "80" });
    expect(!past.ok && past.errors.mde).toMatch(/100% or more/);
    const pts = validatePlan({
      ...emptyPlanDraft(),
      baselinePct: "95",
      mde: "5",
      mdeMode: "absolute",
    });
    expect(!pts.ok && pts.errors.mde).toMatch(/100% or more/);
    const bad = validatePlan({
      ...emptyPlanDraft(),
      baselinePct: "100",
      mde: "-1",
      dailyTraffic: "12.5",
      confidence: 0.8,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors).sort()).toEqual([
        "baselinePct",
        "confidence",
        "dailyTraffic",
        "mde",
      ]);
    }
  });

  it("takes numbers typed with marks", () => {
    const r = validatePlan({
      ...emptyPlanDraft(),
      baselinePct: "10 %",
      mde: "2",
      dailyTraffic: "1,200",
    });
    expect(r.ok && r.values.dailyTraffic).toBe(1200);
  });

  it("sizes a plan, says how long it runs, and when to pick a bigger effect", () => {
    expect(planResult({ ...plan(), dailyTraffic: 800 })).toEqual({
      treatment: 0.12,
      perVariant: 3841,
      total: 7682,
      run: { days: 10, weeks: 2 },
      tooBig: false,
    });
    expect(planResult(plan({ baseline: 0.0001, mde: 0.001 }))?.tooBig).toBe(true);
    expect(planResult(plan({ baseline: 0.9, mde: 0.2 }))).toBeNull();
  });

  it("tables the smallest effect findable in 1 to 4 weeks", () => {
    const rows = effectTable({ ...plan(), dailyTraffic: 800 });
    expect(rows.map((r) => r.weeks)).toEqual([1, 2, 3, 4]);
    expect(rows[1].perVariant).toBe(5600);
    // More weeks find smaller effects.
    const found = rows.map((r) => r.absolute as number);
    expect(found[0]).toBeGreaterThan(found[3]);
    expect(rows[0].relative).toBeCloseTo((rows[0].absolute as number) / 0.1, 10);
    expect(effectTable(plan())).toEqual([]);
  });
});

describe("the counts form", () => {
  it("needs whole numbers, a visitor a version, and conversions at most the visitors", () => {
    expect(
      validateCounts({
        aVisitors: "4,020",
        aConversions: "402",
        bVisitors: "3980",
        bConversions: "477",
      })
    ).toEqual({
      ok: true,
      values: { a: { visitors: 4020, conversions: 402 }, b: { visitors: 3980, conversions: 477 } },
    });
    const r = validateCounts({
      aVisitors: "0",
      aConversions: "",
      bVisitors: "10",
      bConversions: "11",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual({
        aVisitors: "Enter at least one visitor.",
        aConversions: "Enter the conversions.",
        bConversions: "Can't be more than B's visitors.",
      });
    }
    expect(
      validateCounts({ aVisitors: "1.5", aConversions: "1", bVisitors: "10", bConversions: "1" }).ok
    ).toBe(false);
  });

  it("reads a saved test's counts back, blank until a version has visitors", () => {
    expect(
      countsDraftFrom([
        { id: "a", name: "A", visitors: 0, conversions: 0 },
        { id: "b", name: "B", visitors: 10, conversions: 2 },
      ])
    ).toEqual({ aVisitors: "", aConversions: "", bVisitors: "10", bConversions: "2" });
  });
});

describe("the early-look rule", () => {
  const counts = (av: number, bv: number) => ({
    a: { visitors: av, conversions: Math.round(av / 10) },
    b: { visitors: bv, conversions: Math.round(bv / 8) },
  });

  it("calls it too early until the smaller version reaches the plan, and still shows the numbers", () => {
    const r = readResult(plan(), counts(4000, 3100))!;
    expect(r.early).toEqual({ planned: 3841, smaller: 3100, met: false });
    expect(r.verdict).toBe("Too early to call: 3,100 of 3,841 per variant");
    expect(r.sentence).toMatch(/^B converted better than A/);
    expect(r.note).toBeNull();
    const met = readResult(plan(), counts(3841, 3900))!;
    expect(met.early.met).toBe(true);
    expect(met.verdict).toBe(met.sentence);
  });

  it("shows the verdict without a plan, with a note to plan first next time", () => {
    const r = readResult(null, counts(100, 100))!;
    expect(r.verdict).toBe(r.sentence);
    expect(r.note).toBe(NO_PLAN_NOTE);
    expect(earlyLook(null, null)).toEqual({ planned: null, smaller: 0, met: false });
    expect(readResult(plan(), null)).toBeNull();
  });

  it("warns when the split is off", () => {
    const r = readResult(null, counts(10000, 10600))!;
    expect(r.splitWarning).toMatch(/^Check the setup before trusting this/);
  });
});

describe("a saved test", () => {
  const AT = "2026-11-20T09:00:00.000Z";
  const test = (over: Partial<AbTest> = {}): AbTest => ({
    id: "t1",
    name: "Shorter form",
    plan: { ...plan(), dailyTraffic: 800 },
    variants: [
      { id: "a", name: "A", visitors: 4020, conversions: 402 },
      { id: "b", name: "B", visitors: 3980, conversions: 477 },
    ],
    status: "running",
    createdAt: AT,
    updatedAt: AT,
    ...over,
  });

  it("reads its plan and its result", () => {
    const s = testSummary(test());
    expect(s.plan?.perVariant).toBe(3841);
    expect(s.result?.early.met).toBe(true);
    expect(s.result?.analysis.significant).toBe(true);
    const fresh = testSummary(test({ variants: withCounts(undefined, null) }));
    expect(fresh.counts).toBeNull();
    expect(fresh.result).toBeNull();
  });

  it("keeps the versions' ids and names when its counts change", () => {
    const next = withCounts(test().variants, {
      a: { visitors: 1, conversions: 0 },
      b: { visitors: 2, conversions: 1 },
    });
    expect(next).toEqual([
      { id: "a", name: "A", visitors: 1, conversions: 0 },
      { id: "b", name: "B", visitors: 2, conversions: 1 },
    ]);
    expect(testCounts({ variants: [next[0]] })).toBeNull();
  });

  it("leaves out rows that aren't tests, counts the example only alone, and finds a hypothesis's test", () => {
    const odd = { id: "x", name: "odd", variants: [] } as unknown as AbTest;
    expect(abTests([test(), odd]).map((t) => t.id)).toEqual(["t1"]);
    expect(countedTests([test({ id: "example-1" })]).example).toBe(true);
    expect(countedTests([test({ id: "example-1" }), test()]).tests.map((t) => t.id)).toEqual([
      "t1",
    ]);
    const older = test({ id: "old", hypothesisId: "h1", updatedAt: "2026-11-01T00:00:00.000Z" });
    const newer = test({ id: "new", hypothesisId: "h1" });
    expect(testForHypothesis([older, newer, test()], "h1")?.id).toBe("new");
    expect(testForHypothesis([test()], "h1")).toBeUndefined();
  });
});
