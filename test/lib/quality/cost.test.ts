/**
 * lib/quality/cost: the Cost of Quality figures the page and
 * tool.quality_cost.* share.
 *
 *   1. costBreakdown — absent is not 0; a share needs both sides; total 0.
 *   2. hoursTimesRate / costsWithHours — 0, negative, huge; an amount wins.
 *   3. normalizeQualityCostState — legacy blobs, bad values, idempotent.
 *   4. legacyCosts — a first run vs figures typed before periods.
 *   5. failureShareTrend + verdict — one quarter, the change, the trend gate.
 *   6. costPeriodErrors — quarter (a whole one: "2026-Q10" refused),
 *      duplicate, no cost, bad amount.
 */

import { describe, expect, it } from "vitest";
import {
  FAILURE_SHARE_HIGH,
  QUALITY_COST_KEY,
  costBreakdown,
  costPeriodErrors,
  costPeriodQuarter,
  costsWithHours,
  failureShareTrend,
  failureShareVerdict,
  hoursTimesRate,
  legacyCosts,
  newQualityCostPeriodId,
  normalizeQualityCostState,
  typedCostQuarter,
  withoutLegacyCosts,
  type QualityCostPeriod,
} from "@/lib/quality/cost";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";

const period = (
  q: string,
  costs: QualityCostPeriod["costs"],
  id = `qcp_${q}`
): QualityCostPeriod => ({ id, period: q, costs });

describe("costBreakdown", () => {
  it("adds what was entered and names what wasn't", () => {
    const b = costBreakdown({ prevention: 100, detection: 50, internalFailure: 30 });
    expect(b).toEqual({
      entered: 3,
      missing: ["externalFailure"],
      total: 180,
      conformance: 150,
      nonConformance: 30,
      failureShare: 30 / 180,
      externalToInternal: null,
    });
  });

  it("tells an absent cost from a typed 0", () => {
    const absent = costBreakdown({ prevention: 100 });
    const zero = costBreakdown({ prevention: 100, internalFailure: 0, externalFailure: 0 });
    // Nothing on the failure side: no share, never "0% failure".
    expect(absent.failureShare).toBeNull();
    expect(zero.failureShare).toBe(0);
    expect(zero.entered).toBe(3);
  });

  it("has no share with only failure costs, or a total of 0", () => {
    expect(costBreakdown({ internalFailure: 10, externalFailure: 5 }).failureShare).toBeNull();
    const allZero = costBreakdown({
      prevention: 0,
      detection: 0,
      internalFailure: 0,
      externalFailure: 0,
    });
    expect(allZero.total).toBe(0);
    expect(allZero.failureShare).toBeNull();
    expect(costBreakdown({}).entered).toBe(0);
  });

  it("gives external ÷ internal only with both and internal above 0", () => {
    expect(costBreakdown({ internalFailure: 20, externalFailure: 50 }).externalToInternal).toBe(
      2.5
    );
    expect(
      costBreakdown({ internalFailure: 0, externalFailure: 50 }).externalToInternal
    ).toBeNull();
    expect(costBreakdown({ externalFailure: 50 }).externalToInternal).toBeNull();
  });

  it("adds money to the cent and ignores values that aren't amounts", () => {
    const b = costBreakdown({
      prevention: 0.1,
      detection: 0.2,
      internalFailure: -5,
      externalFailure: Number.NaN,
    });
    expect(b.conformance).toBe(0.3);
    expect(b.entered).toBe(2);
    expect(b.failureShare).toBeNull();
  });
});

describe("hoursTimesRate and costsWithHours", () => {
  it("costs hours at the rate, to the cent", () => {
    expect(hoursTimesRate(0, 85)).toBe(0);
    expect(hoursTimesRate(12.5, 80.333)).toBe(1004.16);
    expect(hoursTimesRate(1e9, 150)).toBe(1.5e11);
    expect(hoursTimesRate(-1, 80)).toBeNull();
    expect(hoursTimesRate(10, -80)).toBeNull();
    expect(hoursTimesRate(Number.POSITIVE_INFINITY, 80)).toBeNull();
  });

  it("fills a missing cost from its hours, never replaces an entered one", () => {
    const r = costsWithHours(
      { prevention: 500 },
      { prevention: 10, detection: 4, internalFailure: 2 },
      100
    );
    expect(r.costs).toEqual({ prevention: 500, detection: 400, internalFailure: 200 });
    expect(r.filled).toEqual(["detection", "internalFailure"]);
    expect(r.needRate).toEqual([]);
  });

  it("leaves hours without a rate out and says so", () => {
    const r = costsWithHours({}, { detection: 4 }, undefined);
    expect(r.costs).toEqual({});
    expect(r.needRate).toEqual(["detection"]);
  });
});

describe("normalizeQualityCostState", () => {
  it("reads the blob from before periods as it was", () => {
    const legacy = {
      preventionCost: 1200,
      detectionCost: 800,
      internalFailureCost: 0,
      externalFailureCost: 400,
      description: "Q2 estimate",
    };
    expect(normalizeQualityCostState(legacy)).toEqual(legacy);
  });

  it("drops values that aren't amounts and periods without a quarter", () => {
    const s = normalizeQualityCostState({
      preventionCost: -1,
      detectionCost: "12",
      hourlyRate: Number.NaN,
      periods: [
        { id: "a", period: "Sprint 5", costs: { prevention: 1 } },
        { id: "b", period: "2026 Q2", costs: { prevention: 10, detection: -3 }, note: "n" },
        null,
        { period: "2026-Q1", costs: "nope", hours: { detection: 2 } },
      ],
    });
    expect(s).toEqual({
      periods: [
        { id: "qcp-2026-Q1", period: "2026-Q1", costs: {}, hours: { detection: 2 } },
        { id: "b", period: "2026-Q2", costs: { prevention: 10 }, note: "n" },
      ],
    });
  });

  it("gives the same state when normalised twice", () => {
    const raw = {
      preventionCost: 10,
      periods: [{ period: "Q3 2026", costs: { prevention: 1 } }, period("2026-Q1", {})],
      hourlyRate: 90,
    };
    const once = normalizeQualityCostState(raw);
    expect(normalizeQualityCostState(once)).toEqual(once);
  });

  it("reads anything that isn't an object as a first run", () => {
    expect(normalizeQualityCostState(null)).toEqual({});
    expect(normalizeQualityCostState([1, 2])).toEqual({});
    expect(normalizeQualityCostState("x")).toEqual({});
  });

  it("names the page's blob key", () => {
    expect(QUALITY_COST_KEY).toBe("agile-toolkit:quality-cost");
  });
});

describe("legacyCosts", () => {
  it("is null for the old page's all-zero first run", () => {
    expect(
      legacyCosts({
        preventionCost: 0,
        detectionCost: 0,
        internalFailureCost: 0,
        externalFailureCost: 0,
      })
    ).toBeNull();
    expect(legacyCosts({})).toBeNull();
  });

  it("keeps the zeros beside a typed figure: the page showed them as $0", () => {
    expect(
      legacyCosts({
        preventionCost: 1200,
        detectionCost: 0,
        internalFailureCost: 0,
        externalFailureCost: 400,
      })
    ).toEqual({ prevention: 1200, detection: 0, internalFailure: 0, externalFailure: 400 });
  });

  it("clears them, and their note, once saved as a quarter", () => {
    const next = withoutLegacyCosts({
      preventionCost: 1,
      description: "old",
      hourlyRate: 80,
      periods: [],
    });
    expect(next).toEqual({ hourlyRate: 80, periods: [] });
  });
});

describe("failureShareTrend and failureShareVerdict", () => {
  it("is empty with no quarters", () => {
    const t = failureShareTrend([]);
    expect(t).toEqual({
      points: [],
      latest: null,
      previous: null,
      changeVsPrevious: null,
      trend: null,
    });
    expect(failureShareVerdict(t)).toBeNull();
  });

  it("states the share alone with one quarter", () => {
    const t = failureShareTrend([
      period("2026-Q3", { prevention: 58, detection: 0, internalFailure: 30, externalFailure: 12 }),
    ]);
    expect(t.changeVsPrevious).toBeNull();
    expect(failureShareVerdict(t)).toBe(
      "Failure costs were 42% of quality spend in 2026-Q3. That is above the 30% mark."
    );
  });

  it("orders by quarter and compares with the quarter before", () => {
    const t = failureShareTrend([
      period("2026-Q3", { prevention: 58, internalFailure: 42 }),
      period("2026-Q2", { prevention: 66, internalFailure: 34 }),
    ]);
    expect(t.points.map((p) => p.period)).toEqual(["2026-Q2", "2026-Q3"]);
    expect(t.changeVsPrevious).toBeCloseTo(0.08, 10);
    expect(failureShareVerdict(t)).toBe(
      "Failure costs were 42% of quality spend in 2026-Q3, up 8 points on 2026-Q2. That is above the 30% mark."
    );
  });

  it("skips a quarter without a share when comparing", () => {
    const t = failureShareTrend([
      period("2026-Q1", { prevention: 80, externalFailure: 20 }),
      period("2026-Q2", { prevention: 50 }),
      period("2026-Q3", { prevention: 81, externalFailure: 19 }),
    ]);
    expect(t.points[1].share).toBeNull();
    expect(t.previous?.period).toBe("2026-Q1");
    expect(failureShareVerdict(t)).toBe(
      "Failure costs were 19% of quality spend in 2026-Q3, down 1 point on 2026-Q1."
    );
  });

  it("runs Mann-Kendall only from MIN_SAMPLE.trend quarters with a share", () => {
    const labels = ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"];
    const quarters = labels.map((q, k) =>
      period(q, { prevention: 90 - 5 * k, internalFailure: 10 + 5 * k })
    );
    expect(MIN_SAMPLE.trend).toBe(6);
    expect(failureShareTrend(quarters.slice(0, 5)).trend).toBeNull();
    const six = failureShareTrend(quarters);
    // Every pair rises: S = 6·5/2. (Below 10 points the test never calls it significant.)
    expect(six.trend?.s).toBe(15);
    expect(six.trend?.z).toBeGreaterThan(0);
  });

  it("says level when the rounded share didn't move", () => {
    const t = failureShareTrend([
      period("2026-Q1", { prevention: 80, internalFailure: 20 }),
      period("2026-Q2", { prevention: 80.2, internalFailure: 19.8 }),
    ]);
    expect(failureShareVerdict(t)).toBe(
      "Failure costs were 20% of quality spend in 2026-Q2, level with 2026-Q1."
    );
    expect(FAILURE_SHARE_HIGH).toBe(0.3);
  });
});

describe("costPeriodErrors", () => {
  const logged = [period("2026-Q3", { prevention: 1 }, "qcp_a")];

  it("needs a quarter and at least one cost", () => {
    expect(costPeriodErrors({ period: "", costs: {} }, [])).toEqual({
      period: "Pick the quarter these figures are for.",
      prevention: "Enter at least one cost.",
    });
    expect(costPeriodErrors({ period: "next sprint", costs: { detection: "5" } }, [])).toEqual({
      period: "Pick a quarter, such as 2026-Q3.",
    });
  });

  it("reads only a whole quarter, never one found inside other text", () => {
    const bad = { period: "Pick a quarter, such as 2026-Q3." };
    // "2026-Q10" would read as 2026-Q1 through quarterIndex: refused, not saved as Q1.
    for (const typed of ["2026-Q10", "2026-Q3 budget", "FY2026-Q3", "1800-Q1", "2026-Q5"]) {
      expect(costPeriodErrors({ period: typed, costs: { prevention: 1 } }, []), typed).toEqual(bad);
    }
    for (const typed of ["2026-Q4", " 2026 q4 ", "2026Q4", "Q4 2026", "Q4-2026"]) {
      expect(costPeriodErrors({ period: typed, costs: { prevention: 1 } }, logged), typed).toEqual(
        {}
      );
      expect(typedCostQuarter(typed)).toBe("2026-Q4");
    }
    expect(typedCostQuarter(undefined)).toBeNull();
    // A stored row stays lenient: normalising keeps its place.
    expect(costPeriodQuarter("2026 Q3")).toBe("2026-Q3");
  });

  it("refuses a quarter already logged, except the one being edited", () => {
    expect(costPeriodErrors({ period: "2026 Q3", costs: { prevention: 2 } }, logged)).toEqual({
      period: "Already logged: edit 2026-Q3 below.",
    });
    expect(
      costPeriodErrors({ period: "2026-Q3", costs: { prevention: 2 } }, logged, "qcp_a")
    ).toEqual({});
  });

  it("flags an amount that isn't 0 or more, and accepts a typed 0", () => {
    expect(
      costPeriodErrors(
        { period: "2026-Q4", costs: { prevention: "0", detection: "-1", internalFailure: "abc" } },
        logged
      )
    ).toEqual({
      detection: "Enter an amount of 0 or more.",
      internalFailure: "Enter an amount of 0 or more.",
    });
  });

  it("mints period ids", () => {
    expect(newQualityCostPeriodId()).toMatch(/^qcp_[\w-]{8}$/);
  });
});
