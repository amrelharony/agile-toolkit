/**
 * lib/quality/flaky: the Flaky Test Scoreboard's rates, quarantine ages
 * and status rule, shared by the page and tool.flaky_tests.*.
 *
 *   1. flakyRate / fewRuns — run counts, legacy rate-only rows.
 *   2. weightedFailureRate — 1 of 2 vs 30 of 200; legacy rows counted, not averaged.
 *   3. quarantinedDays / longQuarantined — 13 vs 14 days, unknown dates.
 *   4. applyFlakyStatus — quarantinedAt, fixedAt kept on reopen.
 *   5. flakySummary, worstOffenders, weeklyNewFlakies, the verdict (the
 *      rate over counted tests, rate-only ones named beside it).
 *   6. firstSeenOrderError — never after the quarantine or the fix.
 *   7. flakyTestErrors — inline errors for the add and edit forms.
 */

import { describe, expect, it } from "vitest";
import {
  FEW_RUNS,
  FLAKY_HIGH_RATE,
  QUARANTINE_ALERT_DAYS,
  applyFlakyStatus,
  fewRuns,
  firstSeenOrderError,
  fixedInQuarter,
  flakyDayError,
  flakyRate,
  flakySummary,
  flakyTestErrors,
  flakyVerdict,
  hasRunCounts,
  longQuarantined,
  meanFailureRate,
  quarantinedDays,
  ratePercent,
  weeklyNewFlakies,
  weightedFailureRate,
  withRunCounts,
  worstOffenders,
} from "@/lib/quality/flaky";
import type { FlakyTest } from "@/lib/stores/workspace-types";
import { FLAKY_BOARD } from "../../stores/phase8-fixtures";

const TODAY = "2026-10-27";

function test(partial: Partial<FlakyTest> & { id: string }): FlakyTest {
  return {
    name: partial.id,
    failureRate: 0,
    status: "active",
    firstSeenAt: "2026-10-01",
    ...partial,
  };
}

const counted = (id: string, failures: number, runs: number, extra: Partial<FlakyTest> = {}) =>
  withRunCounts(test({ id, ...extra }), failures, runs);

describe("flakyRate and fewRuns", () => {
  it("reads failures ÷ runs, else the legacy rate", () => {
    expect(flakyRate(counted("a", 3, 40))).toBe(0.075);
    expect(flakyRate(test({ id: "legacy", failureRate: 0.3 }))).toBe(0.3);
    expect(flakyRate(test({ id: "bad", failureRate: Number.NaN }))).toBeNull();
    expect(flakyRate(test({ id: "big", failureRate: 4 }))).toBeNull();
  });

  it("ignores run counts that can't be right", () => {
    const broken = test({ id: "x", failures: 5, runs: 2, failureRate: 0.1 });
    expect(hasRunCounts(broken)).toBe(false);
    expect(flakyRate(broken)).toBe(0.1);
    expect(hasRunCounts(test({ id: "y", failures: 0, runs: 0 }))).toBe(false);
  });

  it("notes a rate on fewer than FEW_RUNS runs", () => {
    expect(FEW_RUNS).toBe(10);
    expect(fewRuns(counted("a", 1, 9))).toBe(true);
    expect(fewRuns(counted("b", 1, 10))).toBe(false);
    expect(fewRuns(test({ id: "legacy", failureRate: 0.5 }))).toBe(false);
  });

  it("keeps the stored rate equal to failures ÷ runs", () => {
    expect(withRunCounts(test({ id: "a", failureRate: 0.9 }), 30, 200).failureRate).toBe(0.15);
  });
});

describe("weightedFailureRate", () => {
  it("weighs each test by its runs, unlike the plain mean", () => {
    const tests = [counted("small", 1, 2), counted("big", 30, 200)];
    const w = weightedFailureRate(tests);
    expect(w).toEqual({ rate: 31 / 202, failures: 31, runs: 202, counted: 2, rateOnly: 0 });
    expect(meanFailureRate(tests)).toBeCloseTo((0.5 + 0.15) / 2, 10);
    // The 1-of-2 test ranks first, but barely moves the weighted rate.
    expect(worstOffenders(tests)[0].id).toBe("small");
  });

  it("leaves legacy rate-only rows and fixed tests out, counting the legacy ones", () => {
    const w = weightedFailureRate(FLAKY_BOARD.tests);
    // ft_1 (30/200, quarantined) only: ft_2 is fixed, ft_legacy has no runs.
    expect(w).toEqual({ rate: 0.15, failures: 30, runs: 200, counted: 1, rateOnly: 1 });
  });

  it("has no rate without a test with run counts", () => {
    expect(weightedFailureRate([]).rate).toBeNull();
    expect(weightedFailureRate([test({ id: "l", failureRate: 0.2 })])).toMatchObject({
      rate: null,
      rateOnly: 1,
    });
    expect(meanFailureRate([])).toBeNull();
  });
});

describe("quarantinedDays and longQuarantined", () => {
  const q = (id: string, quarantinedAt?: string) =>
    test({ id, status: "quarantined", ...(quarantinedAt ? { quarantinedAt } : {}) });

  it("counts whole days since it went in, 0 on the day", () => {
    expect(quarantinedDays(q("a", TODAY), TODAY)).toBe(0);
    expect(quarantinedDays(q("a", "2026-10-14"), TODAY)).toBe(13);
    expect(quarantinedDays(q("a", "2026-10-13"), TODAY)).toBe(14);
  });

  it("alerts from QUARANTINE_ALERT_DAYS, longest first", () => {
    expect(QUARANTINE_ALERT_DAYS).toBe(14);
    const tests = [q("13d", "2026-10-14"), q("14d", "2026-10-13"), q("40d", "2026-09-17")];
    expect(longQuarantined(tests, TODAY)).toEqual([
      { id: "40d", name: "40d", days: 40 },
      { id: "14d", name: "14d", days: 14 },
    ]);
  });

  it("reads a legacy row without a date, a future date, or another status as unknown", () => {
    expect(quarantinedDays(q("legacy"), TODAY)).toBeNull();
    expect(quarantinedDays(q("future", "2026-11-01"), TODAY)).toBeNull();
    expect(
      quarantinedDays(test({ id: "a", status: "active", quarantinedAt: "2026-01-01" }), TODAY)
    ).toBeNull();
    expect(longQuarantined([q("legacy")], TODAY)).toEqual([]);
  });
});

describe("applyFlakyStatus", () => {
  const active = counted("t", 3, 40);

  it("stamps quarantinedAt going in and clears it coming out", () => {
    const quarantined = applyFlakyStatus(active, "quarantined", "2026-10-01");
    expect(quarantined).toMatchObject({ status: "quarantined", quarantinedAt: "2026-10-01" });
    const back = applyFlakyStatus(quarantined, "active", TODAY);
    expect(back.status).toBe("active");
    expect(back.quarantinedAt).toBeUndefined();
    // A fresh quarantine restarts the count.
    expect(applyFlakyStatus(back, "quarantined", TODAY).quarantinedAt).toBe(TODAY);
  });

  it("stamps fixedAt on a fix and keeps it when the test is reopened", () => {
    const fixed = applyFlakyStatus(active, "fixed", "2026-07-10");
    expect(fixed.fixedAt).toBe("2026-07-10");
    const reopened = applyFlakyStatus(fixed, "active", "2026-08-01");
    expect(reopened.fixedAt).toBe("2026-07-10");
    // Fixed again: the latest fix is the one "fixed this quarter" counts.
    expect(applyFlakyStatus(reopened, "fixed", TODAY).fixedAt).toBe(TODAY);
  });

  it("changes nothing for the same status", () => {
    const fixed = applyFlakyStatus(active, "fixed", "2026-07-10");
    expect(applyFlakyStatus(fixed, "fixed", TODAY)).toBe(fixed);
  });

  it("doesn't touch the input", () => {
    const before = JSON.stringify(active);
    applyFlakyStatus(active, "quarantined", TODAY);
    expect(JSON.stringify(active)).toBe(before);
  });
});

describe("flakySummary and friends", () => {
  it("summarises the fixture board", () => {
    const s = flakySummary(FLAKY_BOARD.tests, TODAY);
    expect(s.total).toBe(3);
    expect(s.byStatus).toEqual({ active: 1, quarantined: 1, fixed: 1 });
    expect(s.fixedThisQuarter).toBe(1); // ft_2, fixed 2026-10-10
    expect(s.weighted.rate).toBe(0.15);
    expect(s.meanRate).toBeCloseTo((0.15 + 0.3) / 2, 10);
    expect(s.highRate).toBe(1); // the legacy 0.3 row
    expect(s.longQuarantined).toEqual([{ id: "ft_1", name: "checkout › VAT rounding", days: 22 }]);
    expect(s.quarantineDateUnknown).toBe(0);
    expect(s.worstOffenders.map((o) => o.id)).toEqual(["ft_legacy", "ft_1"]);
    expect(s.worstOffenders[1]).toMatchObject({ failures: 30, runs: 200, fewRuns: false });
    expect(FLAKY_HIGH_RATE).toBe(0.2);
  });

  it("counts a fix only in the quarter it happened", () => {
    const fixed = test({ id: "f", status: "fixed", fixedAt: "2026-09-30" });
    expect(fixedInQuarter(fixed, TODAY)).toBe(false);
    expect(fixedInQuarter({ ...fixed, fixedAt: "2026-10-01" }, TODAY)).toBe(true);
    expect(fixedInQuarter(test({ id: "x", status: "fixed" }), TODAY)).toBe(false);
  });

  it("breaks a tie in rate by runs, then by name", () => {
    const tests = [counted("b", 1, 10), counted("a", 10, 100), counted("c", 10, 100)];
    expect(worstOffenders(tests).map((o) => o.id)).toEqual(["a", "c", "b"]);
    expect(worstOffenders(tests, 1)).toHaveLength(1);
  });

  it("counts new flaky tests per ISO week, quiet weeks as 0", () => {
    const tests = [
      test({ id: "a", firstSeenAt: "2026-10-05" }),
      test({ id: "b", firstSeenAt: "2026-10-06" }),
      test({ id: "c", firstSeenAt: "2026-10-20" }),
      test({ id: "d", firstSeenAt: "not a date" }),
    ];
    expect(weeklyNewFlakies(tests)).toEqual([
      { week: "2026-W41", count: 2 },
      { week: "2026-W42", count: 0 },
      { week: "2026-W43", count: 1 },
    ]);
    expect(weeklyNewFlakies([])).toEqual([]);
  });

  it("says it in one sentence", () => {
    expect(flakyVerdict(flakySummary([], TODAY))).toBe("No flaky tests logged yet.");
    // The 15% of 200 runs is ft_1's alone: the rate-only ft_legacy is named beside it.
    expect(flakyVerdict(flakySummary(FLAKY_BOARD.tests, TODAY))).toBe(
      "1 open flaky test fails 15% of 200 runs (1 more test without run counts); 1 has been quarantined 14 days or more."
    );
    const many = [counted("a", 50, 1000), counted("b", 42, 240)];
    expect(flakyVerdict(flakySummary(many, TODAY))).toBe(
      "2 open flaky tests fail 7.4% of 1,240 runs."
    );
    expect(flakyVerdict(flakySummary([test({ id: "l", failureRate: 0.2 })], TODAY))).toBe(
      "1 open flaky test, none with run counts yet."
    );
    const done = [test({ id: "f", status: "fixed", fixedAt: TODAY })];
    expect(flakyVerdict(flakySummary(done, TODAY))).toBe(
      "No flaky tests open: the one logged is fixed."
    );
    expect(ratePercent(0.15)).toBe("15%");
  });

  it("quotes the rate over the tests it counts, naming the rate-only ones beside it", () => {
    const mixed = [
      counted("a", 50, 1000),
      counted("b", 42, 240),
      test({ id: "l1", failureRate: 0.4 }),
      test({ id: "l2", failureRate: 0.1, status: "quarantined" }),
      // Fixed: out of the rate and out of the rate-only count.
      test({ id: "l3", failureRate: 0.9, status: "fixed" }),
    ];
    const s = flakySummary(mixed, TODAY);
    expect(s.weighted).toMatchObject({ counted: 2, rateOnly: 2, runs: 1240 });
    expect(flakyVerdict(s)).toBe(
      "2 open flaky tests fail 7.4% of 1,240 runs (2 more tests without run counts)."
    );
  });
});

describe("firstSeenOrderError", () => {
  it("refuses a first-seen day after the quarantine or the fix the test carries", () => {
    const t = { quarantinedAt: "2026-10-05" };
    expect(firstSeenOrderError("2026-10-05", t)).toBeNull();
    expect(firstSeenOrderError("2026-10-06", t)).toBe(
      "It can't come after the day it went into quarantine (2026-10-05)."
    );
    // A fixedAt kept from before a reopen still holds the order.
    expect(firstSeenOrderError("2026-10-11", { fixedAt: "2026-10-10" })).toBe(
      "It can't come after the day it was fixed (2026-10-10)."
    );
    // No days carried, or a legacy day that can't be read: nothing to order against.
    expect(firstSeenOrderError("2026-10-20", {})).toBeNull();
    expect(firstSeenOrderError("2026-10-20", { fixedAt: "soon" })).toBeNull();
  });
});

describe("flakyTestErrors", () => {
  it("accepts a complete draft, with a blank first-seen day", () => {
    expect(
      flakyTestErrors({ name: "a", failures: "3", runs: "40", firstSeenAt: "" }, TODAY)
    ).toEqual({});
  });

  it("puts each error on its field", () => {
    expect(flakyTestErrors({ name: " ", failures: "", runs: "0" }, TODAY)).toEqual({
      name: "Enter the test's name.",
      failures: "Enter how many runs failed.",
      runs: "Enter a whole number of 1 or more.",
    });
    expect(flakyTestErrors({ name: "a", failures: "1.5", runs: "abc" }, TODAY)).toEqual({
      failures: "Enter a whole number of 0 or more.",
      runs: "Enter a whole number of 1 or more.",
    });
  });

  it("refuses more failures than runs", () => {
    expect(flakyTestErrors({ name: "a", failures: 5, runs: 4 }, TODAY)).toEqual({
      failures: "It can't fail more often than it ran.",
    });
  });

  it("lets an edited rate-only row keep both counts blank, never just one", () => {
    const legacy = { allowBlankCounts: true };
    expect(flakyTestErrors({ name: "a", failures: " ", runs: "" }, TODAY, legacy)).toEqual({});
    expect(flakyTestErrors({ name: "", failures: "", runs: "" }, TODAY, legacy)).toEqual({
      name: "Enter the test's name.",
    });
    expect(flakyTestErrors({ name: "a", failures: "2", runs: "" }, TODAY, legacy)).toEqual({
      runs: "Enter how many times it ran.",
    });
    expect(flakyTestErrors({ name: "a", failures: 5, runs: 4 }, TODAY, legacy)).toEqual({
      failures: "It can't fail more often than it ran.",
    });
    // Without the option, blank counts are asked for.
    expect(flakyTestErrors({ name: "a", failures: "", runs: "" }, TODAY)).toEqual({
      failures: "Enter how many runs failed.",
      runs: "Enter how many times it ran.",
    });
  });

  it("accepts a backdated first-seen day and refuses a future one", () => {
    const draft = { name: "a", failures: 1, runs: 4 };
    expect(flakyTestErrors({ ...draft, firstSeenAt: "2026-01-02" }, TODAY)).toEqual({});
    expect(flakyTestErrors({ ...draft, firstSeenAt: "2026-10-28" }, TODAY)).toEqual({
      firstSeenAt: "The day can't be after today.",
    });
    expect(flakyDayError("2026-13-01", TODAY)).toBe("Enter a date as YYYY-MM-DD.");
  });

  it("checks an edited test's first-seen day against its stored status days", () => {
    const draft = { name: "a", failures: 1, runs: 4, quarantinedAt: "2026-10-05" };
    expect(flakyTestErrors({ ...draft, firstSeenAt: "2026-10-01" }, TODAY)).toEqual({});
    expect(flakyTestErrors({ ...draft, firstSeenAt: "2026-10-06" }, TODAY)).toEqual({
      firstSeenAt: "It can't come after the day it went into quarantine (2026-10-05).",
    });
    // Blank is the caller's to fill in; the future-day error comes first.
    expect(flakyTestErrors({ ...draft, firstSeenAt: "" }, TODAY)).toEqual({});
    expect(flakyTestErrors({ ...draft, firstSeenAt: "2026-10-28" }, TODAY)).toEqual({
      firstSeenAt: "The day can't be after today.",
    });
  });
});
