/**
 * Calendar periods: ISO weeks across a year boundary (2026 has a week 53),
 * months and quarters in both orders; a value dated by the day written at
 * its start (never by Date.parse); dense ranges with the quiet periods
 * kept; the cap keeping the latest; bounds, order and labels.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_PERIODS,
  bucketByPeriod,
  comparePeriods,
  periodBounds,
  periodKindOf,
  periodLabel,
  periodOf,
  periodRange,
} from "@/lib/analytics/periods";

describe("periodOf", () => {
  it("weeks are ISO weeks, with the year of their Thursday", () => {
    expect(periodOf("2026-10-19", "week")).toBe("2026-W43");
    // 2026 starts on a Thursday, so it has 53 weeks, and its week 1
    // started on Monday 29 December 2025.
    expect(periodOf("2025-12-28", "week")).toBe("2025-W52");
    expect(periodOf("2025-12-29", "week")).toBe("2026-W01");
    expect(periodOf("2026-12-31", "week")).toBe("2026-W53");
    expect(periodOf("2027-01-03", "week")).toBe("2026-W53");
    expect(periodOf("2027-01-04", "week")).toBe("2027-W01");
  });

  it("months and quarters by the local day", () => {
    expect(periodOf("2026-10-19", "month")).toBe("2026-10");
    expect(periodOf("2026-10-19", "quarter")).toBe("2026-Q4");
    expect(periodOf("2026-03-31", "quarter")).toBe("2026-Q1");
    expect(periodOf("2026-04-01", "quarter")).toBe("2026-Q2");
  });

  it("reads a time by the day written at its start, its zone ignored, as working hours do", () => {
    // Sunday 18 October, late evening: week 42 wherever the code runs (a
    // host at UTC+3 read it as Monday, week 43, before).
    expect(periodOf("2026-10-18T23:30:00Z", "week")).toBe("2026-W42");
    expect(periodOf("2026-10-18T23:30:00.000+03:00", "week")).toBe("2026-W42");
    expect(periodOf("2026-10-18T23:30", "week")).toBe("2026-W42");
    expect(periodOf("2026-10-31 23:59", "month")).toBe("2026-10");
    expect(periodOf("2026-12-31T23:30:00-05:00", "quarter")).toBe("2026-Q4");
  });

  it("anything that doesn't start with a real day is undated, never guessed at", () => {
    // Date.parse reads each of these as a date ("Sprint 5" as May 2001).
    for (const value of ["1", "Sprint 5", "abc 12", "Spring 2026", "2026", "Oct 19, 2026"]) {
      expect(periodOf(value, "month"), value).toBeNull();
    }
    expect(periodOf("2026-02-30", "month")).toBeNull();
    expect(periodOf("", "week")).toBeNull();
    expect(periodOf(null, "month")).toBeNull();
    expect(periodOf("not a day", "quarter")).toBeNull();
  });
});

describe("periodRange", () => {
  it("is dense across a year boundary, oldest first", () => {
    expect(periodRange("2026-W52", "2027-W02", "week")).toEqual([
      "2026-W52",
      "2026-W53",
      "2027-W01",
      "2027-W02",
    ]);
    expect(periodRange("2026-11", "2027-02", "month")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(periodRange("2026-Q3", "2027-Q1", "quarter")).toEqual(["2026-Q3", "2026-Q4", "2027-Q1"]);
  });

  it("takes days for the ends as well as labels", () => {
    expect(periodRange("2026-12-30", "2027-01-05", "week")).toEqual(["2026-W53", "2027-W01"]);
    expect(periodRange("2026-10-01", "2026-12-31", "quarter")).toEqual(["2026-Q4"]);
    expect(periodRange("2026 Q4", "2027 Q1", "quarter")).toEqual(["2026-Q4", "2027-Q1"]);
    expect(periodRange("Q4 2026", "Q1 2027", "quarter")).toEqual(["2026-Q4", "2027-Q1"]);
    expect(periodRange("Q4 2026", "2027-Q1", "quarter")).toEqual(["2026-Q4", "2027-Q1"]);
  });

  it("is empty when an end can't be read, is of another kind, or comes first", () => {
    expect(periodRange("2027-W02", "2026-W52", "week")).toEqual([]);
    expect(periodRange("nope", "2026-W52", "week")).toEqual([]);
    expect(periodRange("2026-10", "2026-W52", "week")).toEqual([]);
    expect(periodRange("2027-W53", "2027-W53", "week")).toEqual([]); // 2027 has 52 weeks
    expect(periodRange("2026-13", "2026-13", "month")).toEqual([]);
  });

  it("keeps the latest periods under the cap", () => {
    expect(periodRange("2026-01", "2026-12", "month", 3)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    expect(periodRange("2026-01", "2026-12", "month", 0)).toEqual(["2026-12"]);
    expect(periodRange("2026-01", "2026-12", "month", Number.NaN)).toHaveLength(12);
    const long = periodRange("1950-01-01", "2026-10-19", "week");
    expect(long).toHaveLength(MAX_PERIODS);
    expect(long[long.length - 1]).toBe("2026-W43");
  });
});

describe("bucketByPeriod", () => {
  type Answer = { id: string; date: string | null };
  const answers: Answer[] = [
    { id: "a", date: "2026-08-03" },
    { id: "b", date: "2026-08-20" },
    { id: "c", date: "2026-11-02" },
    { id: "d", date: null },
    { id: "e", date: "junk" },
  ];

  it("groups into dense periods from the first to the last, quiet ones empty", () => {
    const buckets = bucketByPeriod(answers, (a) => a.date, "month");
    expect(buckets.map((b) => [b.period, b.items.map((i) => i.id)])).toEqual([
      ["2026-08", ["a", "b"]],
      ["2026-09", []],
      ["2026-10", []],
      ["2026-11", ["c"]],
    ]);
  });

  it("leaves undated items out, and is empty with none dated", () => {
    const ids = bucketByPeriod(answers, (a) => a.date, "quarter").flatMap((b) =>
      b.items.map((i) => i.id)
    );
    expect(ids).toEqual(["a", "b", "c"]);
    expect(bucketByPeriod([answers[3], answers[4]], (a) => a.date, "week")).toEqual([]);
    expect(bucketByPeriod([], (a: Answer) => a.date, "week")).toEqual([]);
  });

  it("a value Date.parse would read as a date stays out, and doesn't stretch the series", () => {
    const odd = [...answers, { id: "f", date: "1" }, { id: "g", date: "Sprint 5" }];
    const buckets = bucketByPeriod(odd, (a) => a.date, "month");
    expect(buckets[0].period).toBe("2026-08");
    expect(buckets).toHaveLength(4);
    expect(buckets.flatMap((b) => b.items.map((i) => i.id))).toEqual(["a", "b", "c"]);
  });

  it("counts weeks over the year boundary without a gap or a repeat", () => {
    const days = ["2026-12-21", "2027-01-11"].map((date, i) => ({ id: String(i), date }));
    expect(
      bucketByPeriod(days, (d) => d.date, "week").map((b) => [b.period, b.items.length])
    ).toEqual([
      ["2026-W52", 1],
      ["2026-W53", 0],
      ["2027-W01", 0],
      ["2027-W02", 1],
    ]);
  });

  it("keeps the latest periods under the cap, dropping the older items with them", () => {
    const buckets = bucketByPeriod(answers, (a) => a.date, "month", 2);
    expect(buckets.map((b) => b.period)).toEqual(["2026-10", "2026-11"]);
    expect(buckets.flatMap((b) => b.items.map((i) => i.id))).toEqual(["c"]);
  });
});

describe("bounds, order and labels", () => {
  it("periodBounds gives each period's first and last day", () => {
    expect(periodBounds("2026-W53")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(periodBounds("2026-W01")).toEqual({ from: "2025-12-29", to: "2026-01-04" });
    expect(periodBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodBounds("2026-Q4")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodBounds("Q4 2026")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodBounds("q1-2027")).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(periodBounds("2026-W00")).toBeNull();
    expect(periodBounds("2026-00")).toBeNull();
    expect(periodBounds("Q5 2026")).toBeNull();
  });

  it("periodKindOf tells the label's kind", () => {
    expect(periodKindOf("2026-W43")).toBe("week");
    expect(periodKindOf("2026-10")).toBe("month");
    expect(periodKindOf("2026-Q4")).toBe("quarter");
    expect(periodKindOf("2026 Q4")).toBe("quarter");
    expect(periodKindOf("Q4 2026")).toBe("quarter");
    expect(periodKindOf("Q4 2026 extra")).toBeNull();
    expect(periodKindOf("2026-10-19")).toBeNull();
    expect(periodKindOf(undefined)).toBeNull();
  });

  it("comparePeriods sorts oldest first across a year boundary, unreadable last", () => {
    const list = ["2027-W01", "nope", "2026-W53", "2026-W02", "also bad"];
    expect([...list].sort(comparePeriods)).toEqual([
      "2026-W02",
      "2026-W53",
      "2027-W01",
      "also bad",
      "nope",
    ]);
    expect(["2026-Q4", "2026-Q1", "2025-Q4", "Q2 2026"].sort(comparePeriods)).toEqual([
      "2025-Q4",
      "2026-Q1",
      "Q2 2026",
      "2026-Q4",
    ]);
    expect(["2026-12", "2026-02", "2026-10"].sort(comparePeriods)).toEqual([
      "2026-02",
      "2026-10",
      "2026-12",
    ]);
  });

  it("periodLabel reads as people write it", () => {
    expect(periodLabel("2026-W43")).toBe("Week 43, 2026");
    expect(periodLabel("2026-W01")).toBe("Week 1, 2026");
    expect(periodLabel("2026-10")).toBe("Oct 2026");
    expect(periodLabel("2027-01")).toBe("Jan 2027");
    expect(periodLabel("2026-Q4")).toBe("Q4 2026");
    expect(periodLabel("Q4 2026")).toBe("Q4 2026");
    expect(periodLabel("whenever")).toBe("whenever");
  });
});
