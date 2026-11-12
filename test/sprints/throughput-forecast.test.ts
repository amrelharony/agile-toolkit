/**
 * The Release Planner's "count items" forecast (lib/sprints/throughput-
 * forecast): complete weeks only, quiet weeks as 0, seeded runs, the three
 * answers, and a cut line whose dates never go back up the list.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_WEEKS,
  parseWeeklyCounts,
  perWeekText,
  throughputForecast,
  validateWeeklyCounts,
  weekEnd,
  weeklyThroughput,
  weeksUntil,
} from "@/lib/sprints/throughput-forecast";

// Thursday 12 Nov 2026 is in ISO week 2026-W46.
const TODAY = "2026-11-12";
const done = (...days: string[]) => days.map((doneOn) => ({ doneOn }));

describe("weeklyThroughput", () => {
  it("counts complete weeks only, quiet weeks as 0, from the first finish", () => {
    const weeks = weeklyThroughput(
      done(
        "2026-10-13", // W42
        "2026-10-14", // W42
        "2026-10-28", // W44
        "2026-11-03", // W45
        "2026-11-11", // W46: this week, not counted yet
        "not a day"
      ),
      TODAY
    );
    expect(weeks).toEqual([
      { label: "2026-W42", value: 2 },
      { label: "2026-W43", value: 0 },
      { label: "2026-W44", value: 1 },
      { label: "2026-W45", value: 1 },
    ]);
  });

  it("counts the quiet weeks up to last week", () => {
    expect(weeklyThroughput(done("2026-10-20"), TODAY)).toEqual([
      { label: "2026-W43", value: 1 },
      { label: "2026-W44", value: 0 },
      { label: "2026-W45", value: 0 },
    ]);
  });

  it("keeps the last `window` weeks", () => {
    const weeks = weeklyThroughput(done("2026-01-06", "2026-11-02"), TODAY, 8);
    expect(weeks).toHaveLength(8);
    expect(weeks[weeks.length - 1]).toEqual({ label: "2026-W45", value: 1 });
  });

  it("is empty without a finish before this week", () => {
    expect(weeklyThroughput(done("2026-11-10"), TODAY)).toEqual([]);
    expect(weeklyThroughput([], TODAY)).toEqual([]);
  });
});

describe("typed weekly counts", () => {
  it("reads whole numbers, 0 or more, in any separator", () => {
    expect(parseWeeklyCounts("3, 5 0\n4;2")).toEqual({ values: [3, 5, 0, 4, 2], invalid: [] });
    expect(parseWeeklyCounts("3, 2.5, -1, x")).toEqual({
      values: [3],
      invalid: ["2.5", "-1", "x"],
    });
  });

  it("says which entry isn't a count", () => {
    expect(validateWeeklyCounts("3 4 5")).toBeNull();
    expect(validateWeeklyCounts("3 four 5")).toBe(
      "Each week is a whole number of items, 0 or more (not “four”)."
    );
  });
});

describe("dates", () => {
  it("counts whole weeks to a target and dates a week's end", () => {
    expect(weeksUntil("2026-11-16", "2026-12-14")).toBe(4);
    expect(weeksUntil("2026-11-16", "2026-12-13")).toBe(3);
    expect(weeksUntil("2026-11-16", "2026-11-10")).toBe(0);
    expect(weekEnd("2026-11-16", 3)).toBe("2026-12-07");
    expect(perWeekText(1)).toBe("1 item a week");
    expect(perWeekText(4.25)).toBe("4.3 items a week");
  });
});

const SAMPLES = [3, 5, 4, 0, 6, 4, 5, 3];

describe("throughputForecast", () => {
  it("waits for enough weeks, and for a week with a finish", () => {
    const few = throughputForecast({ samples: [3, 4, 5], items: 20, start: "2026-11-16" });
    expect(few).toMatchObject({ enough: false, notEnough: "few-weeks", weeksUsed: 3, when: null });
    expect(MIN_WEEKS).toBe(4);
    const none = throughputForecast({ samples: [0, 0, 0, 0], items: 20, start: "2026-11-16" });
    expect(none).toMatchObject({ enough: false, notEnough: "nothing-finished" });
  });

  it("answers when N items will be done, with dates and a histogram", () => {
    const f = throughputForecast({
      samples: SAMPLES,
      items: 40,
      start: "2026-11-16",
      target: "2027-01-25",
      iterations: 2000,
    });
    expect(f.enough).toBe(true);
    expect(f.average).toBe(3.8);
    const when = f.when!;
    expect(when.items).toBe(40);
    expect(when.weeks.p50).not.toBeNull();
    expect(when.weeks.p50!).toBeLessThanOrEqual(when.weeks.p85!);
    expect(when.weeks.p85!).toBeLessThanOrEqual(when.weeks.p95!);
    // About 40 / 3.75 ≈ 11 weeks at the median.
    expect(when.weeks.p50).toBeGreaterThanOrEqual(9);
    expect(when.weeks.p50).toBeLessThanOrEqual(12);
    expect(when.dates.p85).toBe(weekEnd("2026-11-16", when.weeks.p85!));
    expect(when.histogram.reduce((a, b) => a + b.count, 0)).toBe(2000);
    expect(when.unfinished).toBe(0);
    expect(when.chance).toBeGreaterThan(0);
    expect(when.chance).toBeLessThanOrEqual(1);
  });

  it("gives the same numbers for the same inputs", () => {
    const a = throughputForecast({ samples: SAMPLES, items: 40, start: "2026-11-16" });
    const b = throughputForecast({ samples: SAMPLES, items: 40, start: "2026-11-16" });
    expect(a.when).toEqual(b.when);
  });

  it("draws a quiet week like any other, so zeros slow the forecast", () => {
    const busy = throughputForecast({ samples: [4, 4, 4, 4], items: 40, start: "2026-11-16" });
    const quiet = throughputForecast({
      samples: [4, 4, 4, 4, 0, 0],
      items: 40,
      start: "2026-11-16",
    });
    expect(busy.when!.weeks.p50).toBe(10);
    expect(quiet.when!.weeks.p50!).toBeGreaterThan(10);
  });

  it("answers how many items by a date, as at-least counts", () => {
    const f = throughputForecast({
      samples: [4, 4, 4, 4],
      start: "2026-11-16",
      target: "2026-12-14",
    });
    expect(f.when).toBeNull();
    expect(f.howMany).toMatchObject({ target: "2026-12-14", weeks: 4, p50: 16, p85: 16, p95: 16 });
    const spread = throughputForecast({
      samples: SAMPLES,
      start: "2026-11-16",
      target: "2026-12-14",
    });
    const h = spread.howMany!;
    expect(h.p95).toBeLessThanOrEqual(h.p85);
    expect(h.p85).toBeLessThanOrEqual(h.p50);
  });

  it("has no by-date answer when no whole week fits", () => {
    const f = throughputForecast({ samples: SAMPLES, start: "2026-11-16", target: "2026-11-20" });
    expect(f.howMany).toBeNull();
  });

  it("draws the cut line: dates go up the list, and the target cuts it", () => {
    const f = throughputForecast({
      samples: [4, 4, 4, 4],
      start: "2026-11-16",
      target: "2026-12-28", // 6 weeks: 24 items
      features: [
        { name: "Saved cards", items: 8 },
        { name: "Refunds", items: 12 },
        { name: "Receipts", items: 6 },
        { name: "Nothing in it", items: 0 },
      ],
    });
    const cut = f.cutLine!;
    expect(cut.rows.map((r) => [r.name, r.cumulative, r.weeks.p85, r.inByTarget])).toEqual([
      ["Saved cards", 8, 2, true],
      ["Refunds", 20, 5, true],
      ["Receipts", 26, 7, false],
    ]);
    expect(cut.above).toBe(2);
    expect(cut.rows[1].p85Date).toBe("2026-12-21");
  });

  it("keeps the cut line's dates in order however the runs fall", () => {
    const f = throughputForecast({
      samples: SAMPLES,
      start: "2026-11-16",
      features: Array.from({ length: 8 }, (_, i) => ({ name: `F${i}`, items: 3 + (i % 3) })),
    });
    const rows = f.cutLine!.rows;
    expect(f.cutLine!.above).toBeNull();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].weeks.p50!).toBeGreaterThanOrEqual(rows[i - 1].weeks.p50!);
      expect(rows[i].weeks.p85!).toBeGreaterThanOrEqual(rows[i - 1].weeks.p85!);
      expect(rows[i].inByTarget).toBeNull();
    }
  });
});
