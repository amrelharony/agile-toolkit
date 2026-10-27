/**
 * lib/okrs/progress: the one OKR formula (baseline → target, either way),
 * dated check-ins with the mirrored current and confidence, the confidence
 * trend and the verdict.
 */

import { describe, expect, it } from "vitest";
import {
  KR_CHECK_IN_CAP,
  type KeyResult,
  type KeyResultCheckIn,
  type Okr,
} from "@/lib/stores/workspace-types";
import {
  CONFIDENCE_BAND_LABEL,
  confidenceBand,
  confidenceTrend,
  daysSinceCheckIn,
  krBaseline,
  krDirection,
  krPercent,
  krProgress,
  krProgressText,
  lastCheckIn,
  objectiveConfidence,
  objectivePercent,
  objectiveProgress,
  okrVerdict,
  overallProgress,
  progressTrend,
  quarterPace,
  replacesUndated,
  withCheckIn,
  withoutCheckIn,
} from "@/lib/okrs/progress";
import { FULL_CHECK_INS, LEGACY_OKR, OKR } from "../stores/phase8-fixtures";

const kr = (patch: Partial<KeyResult> = {}): KeyResult => ({
  id: "k",
  title: "KR",
  target: 100,
  current: 0,
  ...patch,
});

const ci = (
  id: string,
  date: string,
  value: number,
  confidence?: number,
  note?: string
): KeyResultCheckIn => ({
  id,
  date,
  value,
  ...(confidence !== undefined ? { confidence } : {}),
  ...(note !== undefined ? { note } : {}),
});

const okr = (keyResults: KeyResult[], patch: Partial<Okr> = {}): Okr => ({
  id: "o",
  objective: "Grow",
  quarter: "2026 Q4",
  keyResults,
  ...patch,
});

describe("krProgress", () => {
  it("runs from the baseline to the target for a key result that should rise", () => {
    expect(krProgress(kr({ baseline: 10, target: 110, current: 60 }))).toBe(0.5);
    expect(krProgress(kr({ baseline: 10, target: 110, current: 10 }))).toBe(0);
    // Over-achievement is capped; falling below the start reads 0.
    expect(krProgress(kr({ baseline: 10, target: 110, current: 300 }))).toBe(1);
    expect(krProgress(kr({ baseline: 10, target: 110, current: 2 }))).toBe(0);
  });

  it("runs down for a key result that should fall", () => {
    const churn = { baseline: 22, target: 15, direction: "decrease" as const };
    expect(krPercent(kr({ ...churn, current: 18 }))).toBe(57); // 4 of 7 points
    expect(krProgress(kr({ ...churn, current: 15 }))).toBe(1);
    expect(krProgress(kr({ ...churn, current: 12 }))).toBe(1);
    expect(krProgress(kr({ ...churn, current: 25 }))).toBe(0);
  });

  it("keeps a row from before Phase 8 (no baseline) on its old numbers", () => {
    expect(krProgress(kr({ target: 100, current: 40 }))).toBe(0.4);
    expect(krProgress(kr({ target: 10, current: 50 }))).toBe(1);
    // A target of 0 read 0% before and still does.
    expect(krProgress(kr({ target: 0, current: 0 }))).toBe(0);
    expect(krProgress(kr({ target: 0, current: 3 }))).toBe(0);
    // Negative targets: the old current / target, clamped.
    expect(krProgress(kr({ target: -5, current: -10 }))).toBe(1);
    expect(krProgress(kr({ target: -5, current: -2 }))).toBe(0.4);
    expect(krProgress(kr({ target: -5, current: 3 }))).toBe(0);
    expect(krPercent(LEGACY_OKR.keyResults[0])).toBe(40);
  });

  it("reads a decrease with no baseline as done or not", () => {
    const tickets = { direction: "decrease" as const, target: 50 };
    expect(krProgress(kr({ ...tickets, current: 60 }))).toBe(0);
    expect(krProgress(kr({ ...tickets, current: 50 }))).toBe(1);
    expect(krProgress(kr({ ...tickets, current: 45 }))).toBe(1);
  });

  it("reads a baseline equal to the target (a number to hold) by the side current is on", () => {
    expect(krProgress(kr({ baseline: 5, target: 5, current: 5 }))).toBe(1);
    expect(krProgress(kr({ baseline: 5, target: 5, current: 4 }))).toBe(0);
    const hold = { baseline: 2, target: 2, direction: "decrease" as const };
    expect(krProgress(kr({ ...hold, current: 1.5 }))).toBe(1);
    expect(krProgress(kr({ ...hold, current: 3 }))).toBe(0);
  });

  it("handles negative baselines and targets", () => {
    // From −20 up to −5: −10 is 10 of 15 points.
    expect(krPercent(kr({ baseline: -20, target: -5, current: -10 }))).toBe(67);
    // From 5 down to −5: 0 is half way.
    expect(krProgress(kr({ baseline: 5, target: -5, current: 0, direction: "decrease" }))).toBe(
      0.5
    );
  });

  it("reads non-finite numbers as 0 and a non-finite baseline as none", () => {
    expect(krProgress(kr({ current: NaN }))).toBe(0);
    expect(krProgress(kr({ target: Infinity, current: 5 }))).toBe(0);
    expect(krProgress(kr({ baseline: NaN, target: 100, current: 40 }))).toBe(0.4);
    expect(krBaseline(kr({ baseline: NaN }))).toBeNull();
  });

  it("lets the numbers decide the direction, the stored one only when they can't", () => {
    expect(krDirection({ baseline: 22, target: 15 })).toBe("decrease");
    expect(krDirection({ baseline: 10, target: 20, direction: "decrease" })).toBe("increase");
    expect(krDirection({ target: 50, direction: "decrease" })).toBe("decrease");
    expect(krDirection({ baseline: 5, target: 5, direction: "decrease" })).toBe("decrease");
    expect(krDirection({ target: 50 })).toBe("increase");
    // A contradicting stored direction can't turn progress around.
    expect(krProgress(kr({ baseline: 10, target: 20, current: 15, direction: "decrease" }))).toBe(
      0.5
    );
  });
});

describe("objective and overall progress", () => {
  it("averages key results per objective, and objectives across the page", () => {
    const a = okr([kr({ target: 100, current: 50 }), kr({ target: 10, current: 10 })]);
    const b = okr([kr({ target: 100, current: 50 })]);
    expect(objectiveProgress(a)).toBe(0.75);
    expect(objectivePercent(a)).toBe(75);
    expect(objectiveProgress(okr([]))).toBe(0);
    // Each objective weighs the same: (0.75 + 0.5) / 2, rounded once.
    expect(overallProgress([a, b])).toBe(0.625);
    expect(overallProgress([])).toBe(0);
    // The fixture: churn 4 of 7 points down, NPS 11 of 20 points up.
    expect(objectivePercent(OKR)).toBe(Math.round(((4 / 7 + 11 / 20) / 2) * 100));
  });
});

describe("krProgressText", () => {
  it("reads a count from 0 as 'x of y'", () => {
    expect(krProgressText(kr({ current: 12, target: 30, unit: "%" }))).toBe("12% of 30%");
    expect(krProgressText(kr({ current: 40, target: 120, unit: "sign-ups" }))).toBe(
      "40 of 120 sign-ups"
    );
    expect(krProgressText(kr({ current: 40, target: 120, baseline: 0, unit: "sign-ups" }))).toBe(
      "40 of 120 sign-ups"
    );
  });

  it("names the start once it matters", () => {
    expect(
      krProgressText(
        kr({ baseline: 22, target: 15, current: 18, unit: "%", direction: "decrease" })
      )
    ).toBe("18% (from 22%, target 15%)");
    expect(krProgressText(kr({ baseline: 10, target: 120, current: 40, unit: "sign-ups" }))).toBe(
      "40 sign-ups (from 10, target 120)"
    );
    expect(
      krProgressText(kr({ direction: "decrease", target: 50, current: 60, unit: "tickets" }))
    ).toBe("60 tickets (target 50 or below, no baseline)");
  });
});

describe("withCheckIn", () => {
  const start = kr({ baseline: 0, target: 10, current: 0, checkIns: [] });

  it("records a check-in and mirrors current and confidence from it", () => {
    const next = withCheckIn(start, ci("c1", "2026-10-05", 3, 6));
    expect(next.checkIns).toEqual([ci("c1", "2026-10-05", 3, 6)]);
    expect(next.current).toBe(3);
    expect(next.confidence).toBe(6);
    // The input is untouched.
    expect(start.checkIns).toEqual([]);
    expect(start.current).toBe(0);
  });

  it("files a backdated check-in by its date without changing current", () => {
    const one = withCheckIn(start, ci("c1", "2026-10-05", 3, 6));
    const two = withCheckIn(one, ci("c0", "2026-10-01", 1, 4));
    expect(two.checkIns?.map((c) => c.id)).toEqual(["c0", "c1"]);
    expect(two.current).toBe(3);
    expect(two.confidence).toBe(6);
  });

  it("keeps the last scored confidence when the newest check-in isn't scored", () => {
    const one = withCheckIn(start, ci("c1", "2026-10-05", 3, 6));
    const two = withCheckIn(one, ci("c2", "2026-10-08", 5));
    expect(two.current).toBe(5);
    expect(two.confidence).toBe(6);
    // A confidence typed before any check-in stays until one is scored.
    const typed = withCheckIn(kr({ confidence: 7 }), ci("c1", "2026-10-05", 30));
    expect(typed.confidence).toBe(7);
    expect(withCheckIn(typed, ci("c2", "2026-10-06", 31, 2)).confidence).toBe(2);
  });

  it("orders same-day check-ins as they were made, the later one newest", () => {
    const one = withCheckIn(start, ci("a", "2026-10-08", 4));
    const two = withCheckIn(one, ci("b", "2026-10-08", 6));
    expect(two.checkIns?.map((c) => c.id)).toEqual(["a", "b"]);
    expect(two.current).toBe(6);
  });

  it("replaces a check-in with the same id in place", () => {
    let k = withCheckIn(start, ci("c0", "2026-10-01", 1, 4));
    k = withCheckIn(k, ci("c1", "2026-10-05", 3, 6));
    const edited = withCheckIn(k, ci("c0", "2026-10-01", 2, 5));
    expect(edited.checkIns?.map((c) => [c.id, c.value])).toEqual([
      ["c0", 2],
      ["c1", 3],
    ]);
    expect(edited.current).toBe(3);
    // Moving it after the newest makes it the newest.
    const moved = withCheckIn(k, ci("c0", "2026-10-09", 9));
    expect(moved.checkIns?.map((c) => c.id)).toEqual(["c1", "c0"]);
    expect(moved.current).toBe(9);
    expect(moved.confidence).toBe(6);
  });

  it("drops the score an edit clears", () => {
    const scored = withCheckIn(start, ci("c1", "2026-10-05", 3, 6));
    const cleared = withCheckIn(scored, ci("c1", "2026-10-05", 3));
    expect(cleared.confidence).toBeUndefined();
    expect("confidence" in cleared).toBe(false);
  });

  it("keeps the newest KR_CHECK_IN_CAP, dropping the oldest", () => {
    const full = kr({ checkIns: FULL_CHECK_INS, current: 51 });
    const next = withCheckIn(full, ci("new", "2026-10-02", 99));
    expect(next.checkIns).toHaveLength(KR_CHECK_IN_CAP);
    expect(next.checkIns?.[0].id).toBe("ci_full_1");
    expect(next.checkIns?.at(-1)?.id).toBe("new");
    expect(next.current).toBe(99);
    // One older than every kept check-in is dropped at once.
    const old = withCheckIn(full, ci("old", "2026-09-01", -1));
    expect(old.checkIns).toHaveLength(KR_CHECK_IN_CAP);
    expect(old.checkIns?.some((c) => c.id === "old")).toBe(false);
    expect(old.current).toBe(51);
  });
});

describe("replacesUndated", () => {
  const TODAY = "2026-11-03";
  // A row from before Phase 8: current 40 and confidence 5, typed, no check-ins.
  const legacy = LEGACY_OKR.keyResults[0];

  it("names the typed value a backdated first check-in rolls back", () => {
    expect(replacesUndated(legacy, ci("x", "2026-09-15", 20), TODAY)).toEqual({
      current: 40,
      confidence: null,
    });
    expect(replacesUndated(legacy, ci("x", "2026-09-15", 20, 3), TODAY)).toEqual({
      current: 40,
      confidence: 5,
    });
    // withCheckIn still records it as the newest reading there is.
    expect(withCheckIn(legacy, ci("x", "2026-09-15", 20, 3))).toMatchObject({
      current: 20,
      confidence: 3,
    });
  });

  it("is null for today's reading, the same value, or a key result already checked in", () => {
    expect(replacesUndated(legacy, ci("x", TODAY, 20, 3), TODAY)).toBeNull();
    expect(replacesUndated(legacy, ci("x", "2026-09-15", 40, 5), TODAY)).toBeNull();
    expect(replacesUndated(legacy, ci("x", "soon", 20, 3), TODAY)).toBeNull();
    const checked = withCheckIn(legacy, ci("a", "2026-10-20", 45, 6));
    expect(replacesUndated(checked, ci("x", "2026-09-15", 20, 3), TODAY)).toBeNull();
  });

  it("names a typed confidence the first scored check-in replaces under unscored ones", () => {
    const unscored = withCheckIn(legacy, ci("a", "2026-10-20", 45));
    expect(replacesUndated(unscored, ci("x", "2026-09-15", 20, 3), TODAY)).toEqual({
      current: null,
      confidence: 5,
    });
    expect(withCheckIn(unscored, ci("x", "2026-09-15", 20, 3))).toMatchObject({
      current: 45,
      confidence: 3,
    });
  });
});

describe("withoutCheckIn", () => {
  const base = kr({ baseline: 2, target: 10, current: 0, checkIns: [] });
  const three = [
    ci("a", "2026-10-01", 3, 4),
    ci("b", "2026-10-05", 5, 6),
    ci("c", "2026-10-08", 7),
  ].reduce(withCheckIn, base);

  it("re-mirrors current and confidence from the rest", () => {
    expect(three.current).toBe(7);
    expect(three.confidence).toBe(6);
    const noC = withoutCheckIn(three, "c");
    expect(noC.current).toBe(5);
    expect(noC.confidence).toBe(6);
    const noB = withoutCheckIn(three, "b");
    expect(noB.current).toBe(7);
    expect(noB.confidence).toBe(4);
  });

  it("takes a removed score with it when no scored check-in is left", () => {
    const one = withCheckIn(base, ci("only", "2026-10-01", 3, 4));
    const none = withoutCheckIn(one, "only");
    expect(none.checkIns).toEqual([]);
    expect(none.confidence).toBeUndefined();
    // Back to the baseline, where the key result started.
    expect(none.current).toBe(2);
  });

  it("keeps the value of a key result with no baseline when its last check-in goes", () => {
    const one = withCheckIn(kr({ current: 40, confidence: 7 }), ci("x", "2026-10-01", 50));
    const none = withoutCheckIn(one, "x");
    // The typed 40 isn't kept anywhere: a caller's undo keeps the whole key result.
    expect(none.current).toBe(50);
    // An unscored check-in leaves the typed confidence alone.
    expect(none.confidence).toBe(7);
  });

  it("returns the key result as it was for an unknown id", () => {
    expect(withoutCheckIn(three, "nope")).toBe(three);
  });
});

describe("lastCheckIn and daysSinceCheckIn", () => {
  it("find the newest-dated readable check-in", () => {
    const k = kr({
      checkIns: [ci("a", "2026-10-09", 1), ci("b", "2026-10-02", 2), ci("bad", "soon", 3)],
    });
    expect(lastCheckIn(k)?.id).toBe("a");
    expect(daysSinceCheckIn(k, "2026-10-23")).toBe(14);
    expect(lastCheckIn(kr())).toBeNull();
    expect(daysSinceCheckIn(kr(), "2026-10-23")).toBeNull();
  });
});

describe("confidence", () => {
  it("bands a score, and leaves an unscored or off-scale one out", () => {
    expect(confidenceBand(3)).toBe("off-track");
    expect(confidenceBand(3.5)).toBe("at-risk");
    expect(confidenceBand(6)).toBe("at-risk");
    expect(confidenceBand(7)).toBe("on-track");
    expect(confidenceBand(undefined)).toBeNull();
    expect(confidenceBand(12)).toBeNull();
    expect(CONFIDENCE_BAND_LABEL["at-risk"]).toBe("At risk");
  });

  it("averages the scored key results only", () => {
    expect(objectiveConfidence(okr([kr({ confidence: 8 }), kr({ confidence: 5 }), kr()]))).toBe(
      6.5
    );
    expect(objectiveConfidence(okr([kr(), kr({ confidence: 12 })]))).toBeNull();
  });

  it("trends the mean of each key result's latest scored confidence, per scored day", () => {
    const a = kr({ checkIns: [ci("a1", "2026-10-01", 1, 8), ci("a2", "2026-10-08", 2, 6)] });
    const b = kr({
      confidence: 9, // typed without a check-in: no day, not plotted
      checkIns: [ci("b1", "2026-10-04", 1, 4), ci("b2", "2026-10-06", 2)],
    });
    expect(confidenceTrend(okr([a, b]))).toEqual([
      { date: "2026-10-01", confidence: 8, scored: 1 },
      { date: "2026-10-04", confidence: 6, scored: 2 },
      { date: "2026-10-08", confidence: 5, scored: 2 },
    ]);
    expect(confidenceTrend(okr([kr({ confidence: 5 })]))).toEqual([]);
  });

  it("counts a score with no dated check-in on every day, so the last point is the headline", () => {
    // kr_a from before Phase 8 keeps its default 5; the other key result
    // is checked in twice, and one only over unscored check-ins keeps its typed 9.
    const checked = [ci("c1", "2026-10-01", 1, 8), ci("c2", "2026-10-08", 2, 6)].reduce(
      withCheckIn,
      kr({ confidence: 5 })
    );
    const unscored = withCheckIn(kr({ confidence: 9 }), ci("u1", "2026-10-05", 3));
    const o = okr([LEGACY_OKR.keyResults[0], checked, unscored]);
    expect(confidenceTrend(o)).toEqual([
      { date: "2026-10-01", confidence: 7.3, scored: 3 }, // (5 + 8 + 9) / 3
      { date: "2026-10-08", confidence: 6.7, scored: 3 }, // (5 + 6 + 9) / 3
    ]);
    expect(confidenceTrend(o).at(-1)?.confidence).toBe(objectiveConfidence(o));
  });
});

describe("progressTrend", () => {
  it("replays objectiveProgress per check-in day, so the last point is the headline", () => {
    // Churn 22% → 15%, checked in on 1 and 8 Oct; sign-ups checked in from
    // 8 Oct only; a row from before Phase 8 never checked in (40 of 100).
    const churn = [ci("a", "2026-10-01", 21), ci("b", "2026-10-08", 19)].reduce(
      withCheckIn,
      kr({ baseline: 22, direction: "decrease", target: 15, current: 22 })
    );
    const signups = withCheckIn(
      kr({ baseline: 20, target: 120, current: 20 }),
      ci("c", "2026-10-08", 70)
    );
    const o = okr([churn, signups, LEGACY_OKR.keyResults[0]]);
    const points = progressTrend(o);
    expect(points.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-08"]);
    // (1/7 + 0 at its baseline + 0.4) / 3, then (3/7 + 0.5 + 0.4) / 3.
    expect(points[0].progress).toBeCloseTo((1 / 7 + 0 + 0.4) / 3, 10);
    expect(points[0].measured).toBe(1);
    expect(points[1].progress).toBeCloseTo((3 / 7 + 0.5 + 0.4) / 3, 10);
    expect(points[1].measured).toBe(2);
    expect(points.at(-1)?.progress).toBe(objectiveProgress(o));
  });

  it("reads a key result at its baseline before its first check-in, 0 with none", () => {
    // A number to hold (baseline = target) is held at its baseline; a falling
    // key result from before Phase 8 has no start, so it reads 0, not "reached".
    const hold = withCheckIn(
      kr({ baseline: 99, target: 99, current: 99 }),
      ci("h", "2026-10-08", 98)
    );
    const noBase = withCheckIn(
      kr({ direction: "decrease", target: 15, current: 30 }),
      ci("n", "2026-10-08", 12)
    );
    const early = withCheckIn(kr({ target: 10, current: 0 }), ci("e", "2026-10-01", 5));
    const points = progressTrend(okr([hold, noBase, early]));
    expect(points[0]).toEqual({ date: "2026-10-01", progress: (1 + 0 + 0.5) / 3, measured: 1 });
    // 8 Oct: the hold slipped (0), the falling one reached its target (1).
    expect(points[1]).toEqual({ date: "2026-10-08", progress: (0 + 1 + 0.5) / 3, measured: 3 });
  });

  it("has no point without a readable dated check-in", () => {
    expect(progressTrend(okr([]))).toEqual([]);
    expect(progressTrend(okr([kr({ current: 40 })]))).toEqual([]);
    expect(progressTrend(okr([kr({ checkIns: [ci("bad", "soon", 3)] })]))).toEqual([]);
  });
});

describe("quarterPace", () => {
  it("measures the days gone in the quarter, today included", () => {
    expect(quarterPace("2026 Q4", "2026-11-03")).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
      totalDays: 92,
      elapsedDays: 34,
      daysLeft: 58,
      elapsedShare: 34 / 92,
      phase: "during",
    });
    expect(quarterPace("Q4 2026", "2026-09-30")?.phase).toBe("before");
    expect(quarterPace("2026-Q4", "2027-01-01")).toMatchObject({ phase: "after", daysLeft: 0 });
    expect(quarterPace("next spring", "2026-11-03")).toBeNull();
  });
});

describe("okrVerdict", () => {
  const NOW = new Date(2026, 10, 3); // 3 Nov 2026: 34 of Q4's 92 days gone
  const climbing = [ci("c1", "2026-10-03", 40, 8), ci("c2", "2026-10-20", 63, 6)].reduce(
    withCheckIn,
    kr({ baseline: 0, target: 100, checkIns: [] })
  );

  it("weighs progress against the quarter's days and says where confidence went", () => {
    expect(okrVerdict(okr([climbing]), NOW)).toBe(
      "63% of the way with 58 of 92 days left (37% of the quarter gone): ahead of pace; confidence 6/10, down from 8 since 3 Oct."
    );
    const steady = withCheckIn(climbing, ci("c3", "2026-10-25", 63, 6));
    expect(okrVerdict(okr([steady]), NOW)).toMatch(/confidence 6\/10, unchanged since 20 Oct\.$/);
  });

  it("reads no move when only a key result with an undated score sits beside the checked-in one", () => {
    // Both key results carry the old silent default 5; one is then checked
    // in twice at 8. The mean is 6.5 throughout: nothing moved.
    const legacy = (id: string) => kr({ id, current: 50, confidence: 5 });
    const k1 = [ci("c1", "2026-10-01", 50, 8), ci("c2", "2026-10-08", 55, 8)].reduce(
      withCheckIn,
      legacy("k1")
    );
    expect(okrVerdict(okr([k1, legacy("k2")]), NOW)).toMatch(
      /; confidence 6\.5\/10, unchanged since 1 Oct\.$/
    );
    // A real move on the checked-in key result reads against the same mean.
    const down = withCheckIn(k1, ci("c3", "2026-10-20", 56, 6));
    expect(okrVerdict(okr([down, legacy("k2")]), NOW)).toMatch(
      /; confidence 5\.5\/10, down from 6\.5 since 8 Oct\.$/
    );
  });

  it("says when fewer key results were scored at the reading before", () => {
    const a = withCheckIn(kr({ id: "a", current: 50 }), ci("a1", "2026-10-01", 50, 8));
    const b = withCheckIn(kr({ id: "b", current: 50 }), ci("b1", "2026-10-08", 50, 4));
    expect(okrVerdict(okr([a, b]), NOW)).toMatch(
      /; confidence 6\/10, down from 8 since 1 Oct \(1 of 2 key results scored then\)\.$/
    );
  });

  it("reads on pace within 5 points and behind below", () => {
    const at = (current: number) => okr([kr({ baseline: 0, target: 100, current })]);
    expect(okrVerdict(at(40), NOW)).toContain(": on pace;");
    expect(okrVerdict(at(30), NOW)).toContain(": behind pace;");
    expect(okrVerdict(at(30), NOW)).toMatch(/; confidence not scored\.$/);
  });

  it("says how many key results are scored when some aren't", () => {
    const o = okr([kr({ current: 50, confidence: 7 }), kr({ current: 50 })]);
    expect(okrVerdict(o, NOW)).toMatch(/confidence 7\/10 \(1 of 2 key results scored\)\.$/);
  });

  it("covers a quarter not started, one ended, one unreadable, and a finished objective", () => {
    const o = (quarter: string) => okr([kr({ current: 63 })], { quarter });
    expect(okrVerdict(o("2027 Q1"), NOW)).toBe(
      "63% of the way; 2027 Q1 starts 1 Jan; confidence not scored."
    );
    expect(okrVerdict(o("Q3 2026"), NOW)).toBe(
      "2026 Q3 ended at 63% of the way; confidence not scored."
    );
    expect(okrVerdict(o("next spring"), NOW)).toBe(
      "63% of the way (no quarter to judge the pace against); confidence not scored."
    );
    expect(okrVerdict(okr([kr({ current: 100 })]), NOW)).toBe(
      "Every key result has reached its target; confidence not scored."
    );
    expect(okrVerdict(okr([]), NOW)).toBe("No key results yet: add one to measure this objective.");
  });
});
