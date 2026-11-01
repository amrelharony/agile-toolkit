/**
 * lib/nps/score: NPS with null for none, CSAT as % satisfied, theme tags,
 * and calendar periods with their n, empty periods kept.
 */

import { describe, expect, it } from "vitest";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import {
  answerSwing,
  csatCategory,
  hasTag,
  isReadableScore,
  isValidScore,
  latestEnough,
  normalizeTags,
  npsCategory,
  periodSeries,
  realResponses,
  summarizeCsat,
  summarizeNps,
  tagCounts,
  tagsProblem,
} from "@/lib/nps/score";
import { exampleId } from "@/lib/utils/example-id";
import { LEGACY_CSAT, NPS } from "../stores/phase8-fixtures";

let seq = 0;
const r = (
  kind: NpsResponse["kind"],
  score: number,
  date: string,
  tags?: string[]
): NpsResponse => ({ id: `r${seq++}`, kind, score, date, ...(tags ? { tags } : {}) });

describe("categories and scales", () => {
  it("buckets NPS 9-10 / 7-8 / 0-6 and CSAT 4-5 / 3 / 1-2", () => {
    expect([10, 9, 8, 7, 6, 0].map(npsCategory)).toEqual([
      "promoter",
      "promoter",
      "passive",
      "passive",
      "detractor",
      "detractor",
    ]);
    // A fraction the old page saved reads by the same thresholds.
    expect(npsCategory(7.5)).toBe("passive");
    expect([5, 4, 3, 2, 1].map(csatCategory)).toEqual([
      "satisfied",
      "satisfied",
      "neutral",
      "dissatisfied",
      "dissatisfied",
    ]);
  });

  it("takes a whole number on the kind's scale for a write, and reads a fraction on it", () => {
    expect(isValidScore("nps", 0)).toBe(true);
    expect(isValidScore("nps", 10)).toBe(true);
    expect(isValidScore("nps", 11)).toBe(false);
    expect(isValidScore("nps", 7.5)).toBe(false);
    expect(isValidScore("csat", 0)).toBe(false);
    expect(isValidScore("csat", 5)).toBe(true);
    expect(isValidScore("csat", 6)).toBe(false);
    expect(isReadableScore("nps", 7.5)).toBe(true);
    expect(isReadableScore("csat", 9)).toBe(false);
    expect(isReadableScore("nps", NaN)).toBe(false);
  });
});

describe("summaries", () => {
  it("reads NPS as null with no responses, never 0", () => {
    expect(summarizeNps([])).toEqual({
      n: 0,
      score: null,
      promoters: 0,
      passives: 0,
      detractors: 0,
    });
    expect(summarizeCsat([])).toEqual({ n: 0, satisfied: 0, satisfiedPct: null, average: null });
  });

  it("scores NPS as %promoters − %detractors", () => {
    const rs = [9, 10, 9, 7, 4].map((s) => r("nps", s, "2026-10-01"));
    expect(summarizeNps(rs)).toEqual({ n: 5, score: 40, promoters: 3, passives: 1, detractors: 1 });
    // A real 0 is a score.
    expect(summarizeNps([r("nps", 9, "2026-10-01"), r("nps", 3, "2026-10-01")]).score).toBe(0);
  });

  it("reads CSAT as % satisfied, with the mean to one decimal", () => {
    const rs = [5, 4, 3, 2, 1, 4].map((s) => r("csat", s, "2026-10-01"));
    expect(summarizeCsat(rs)).toEqual({ n: 6, satisfied: 3, satisfiedPct: 50, average: 3.2 });
  });

  it("ignores the other kind and scores off the scale", () => {
    const rs = [r("nps", 9, "x"), r("nps", 11, "x"), r("csat", 9, "x"), r("csat", 5, "x")];
    expect(summarizeNps(rs).n).toBe(1);
    expect(summarizeCsat(rs).n).toBe(1);
    expect(summarizeNps([r("nps", 7.5, "x")]).passives).toBe(1);
  });

  it("leaves example rows out of the team's own", () => {
    const rs = [NPS, { ...NPS, id: exampleId("nps-1") }];
    expect(realResponses(rs)).toEqual([NPS]);
  });

  it("quotes the swing of one answer", () => {
    expect(answerSwing(6)).toBe(17);
    expect(answerSwing(1)).toBe(100);
    expect(answerSwing(0)).toBeNull();
  });
});

describe("tags", () => {
  it("normalises typed tags: split, trimmed, lower-case, once each", () => {
    expect(normalizeTags(" Pricing, onboarding ,pricing,, Check  Out ")).toEqual([
      "pricing",
      "onboarding",
      "check out",
    ]);
    expect(normalizeTags(["A,b", "c", "B"])).toEqual(["a", "b", "c"]);
    expect(normalizeTags("")).toEqual([]);
  });

  it("keeps a stored row within the schema, and says what a write would cut", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `t${i}`);
    expect(normalizeTags(twelve)).toHaveLength(10);
    expect(tagsProblem(twelve)).toBe("At most 10 tags on a response (12 given).");
    const long = "x".repeat(41);
    expect(normalizeTags(long)).toEqual(["x".repeat(40)]);
    expect(tagsProblem(`ok, ${long}`)).toBe(`“${"x".repeat(20)}…” is longer than 40 characters.`);
    // Duplicates count once.
    expect(tagsProblem([...twelve.slice(0, 10), "T0", "t1"])).toBeNull();
    expect(tagsProblem("pricing, support")).toBeNull();
  });

  it("matches a tag as normalised", () => {
    expect(hasTag(NPS, "Pricing")).toBe(true);
    expect(hasTag(NPS, " board ")).toBe(true);
    expect(hasTag(NPS, "support")).toBe(false);
    expect(hasTag(LEGACY_CSAT, "pricing")).toBe(false);
    expect(hasTag(NPS, "")).toBe(false);
  });

  it("counts each tag's responses, most unhappy first", () => {
    const rs = [
      r("nps", 3, "2026-10-01", ["pricing"]),
      r("nps", 9, "2026-10-01", ["pricing", "Board"]),
      r("csat", 1, "2026-10-01", ["support"]),
      r("csat", 2, "2026-10-01", ["support"]),
      r("csat", 5, "2026-10-01", ["board"]),
      r("nps", 12, "2026-10-01", ["ignored"]),
    ];
    const counts = tagCounts(rs);
    expect(counts.map((t) => [t.tag, t.n, t.unhappy])).toEqual([
      ["support", 2, 2],
      ["pricing", 2, 1],
      ["board", 2, 0],
    ]);
    expect(counts[1]).toMatchObject({ promoters: 1, detractors: 1, nps: { n: 2, score: 0 } });
    expect(counts[0]).toMatchObject({ dissatisfied: 2, satisfied: 0, csat: { satisfiedPct: 0 } });
  });
});

describe("periodSeries", () => {
  it("runs month by month from the first response to the last, empty months kept", () => {
    const rs = [
      r("nps", 9, "2026-08-02"),
      r("csat", 4, "2026-08-20"),
      r("nps", 3, "2026-10-20"),
      r("nps", 10, "2026-10-31T23:30:00Z"),
    ];
    const { points, undated, offScale } = periodSeries(rs, "month");
    expect(points.map((p) => [p.period, p.label, p.from, p.to, p.nps.n, p.csat.n])).toEqual([
      ["2026-08", "Aug 2026", "2026-08-01", "2026-08-31", 1, 1],
      ["2026-09", "Sep 2026", "2026-09-01", "2026-09-30", 0, 0],
      ["2026-10", "Oct 2026", "2026-10-01", "2026-10-31", 2, 0],
    ]);
    expect(points[1].nps.score).toBeNull();
    expect(points[2].nps.score).toBe(0);
    expect(undated).toBe(0);
    expect(offScale).toBe(0);
  });

  it("uses ISO weeks across a year boundary, the gaps kept", () => {
    // 2026 has 53 ISO weeks: 28 Dec 2026 - 3 Jan 2027 is 2026-W53.
    const rs = [r("nps", 9, "2026-12-14"), r("nps", 9, "2026-12-30"), r("nps", 9, "2027-01-05")];
    const { points } = periodSeries(rs, "week");
    expect(points.map((p) => [p.period, p.nps.n])).toEqual([
      ["2026-W51", 1],
      ["2026-W52", 0],
      ["2026-W53", 1],
      ["2027-W01", 1],
    ]);
    expect(points[2]).toMatchObject({
      from: "2026-12-28",
      to: "2027-01-03",
      label: "Week 53, 2026",
    });
  });

  it("flags each period against MIN_SAMPLE.surveyPeriod", () => {
    const n = MIN_SAMPLE.surveyPeriod;
    const rs = [
      ...Array.from({ length: n }, () => r("nps", 9, "2026-10-05")),
      ...Array.from({ length: n - 1 }, () => r("csat", 5, "2026-10-06")),
    ];
    const [oct] = periodSeries(rs, "month").points;
    expect(oct.enoughNps).toBe(true);
    expect(oct.enoughCsat).toBe(false);
    expect(oct.csat.satisfiedPct).toBe(100);
  });

  it("counts undated rows and scores off the scale apart, plotting neither", () => {
    const rs = [
      r("nps", 9, ""),
      r("nps", 9, "Sprint 5"),
      r("nps", 11, "2026-10-01"),
      r("csat", 9, ""),
      r("nps", 7.5, "2026-10-02"),
    ];
    const s = periodSeries(rs, "month");
    expect(s.undated).toBe(2);
    expect(s.offScale).toBe(2);
    expect(s.points.map((p) => [p.period, p.nps.n, p.nps.passives])).toEqual([["2026-10", 1, 1]]);
    expect(periodSeries([r("nps", 9, "")], "week")).toEqual({
      points: [],
      undated: 1,
      offScale: 0,
    });
  });

  it("filters by a tag, keeps the latest periods, and runs on to a given day", () => {
    const rs = [
      r("nps", 9, "2026-06-10", ["pricing"]),
      r("nps", 3, "2026-08-10", ["Support"]),
      r("nps", 4, "2026-10-20", ["support"]),
    ];
    const support = periodSeries(rs, "month", { tag: "SUPPORT" }).points;
    expect(support.map((p) => [p.period, p.nps.n])).toEqual([
      ["2026-08", 1],
      ["2026-09", 0],
      ["2026-10", 1],
    ]);
    expect(periodSeries(rs, "month", { maxPeriods: 2 }).points.map((p) => p.period)).toEqual([
      "2026-09",
      "2026-10",
    ]);
    const through = periodSeries(rs, "month", { through: "2026-12-05" }).points;
    expect(through.map((p) => p.period).slice(-3)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(through.at(-1)?.nps.n).toBe(0);
    // A day before the last response doesn't cut the series short.
    expect(periodSeries(rs, "month", { through: "2026-07-01" }).points.at(-1)?.period).toBe(
      "2026-10"
    );
  });

  it("finds the latest period with enough responses for the headline", () => {
    const n = MIN_SAMPLE.surveyPeriod;
    const rs = [
      ...Array.from({ length: n }, () => r("nps", 9, "2026-08-05")),
      ...Array.from({ length: n }, () => r("csat", 4, "2026-09-05")),
      r("nps", 2, "2026-10-01"),
    ];
    const { points } = periodSeries(rs, "month");
    expect(latestEnough(points, "nps")?.period).toBe("2026-08");
    expect(latestEnough(points, "csat")?.period).toBe("2026-09");
    expect(latestEnough([], "nps")).toBeNull();
  });
});
