/**
 * The shared sprint metrics: velocity over the latest sprints by end date
 * (never the stored order), graded say/do, a least-squares finish, one
 * percentile method, % done against the current scope, and a gap that is
 * positive when behind. Edge cases at empty, zero and huge inputs.
 */

import { describe, expect, it } from "vitest";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { DEFAULT_CALENDAR } from "@/lib/sprints/calendar";
import {
  DEFAULT_VELOCITY_WINDOW,
  completionPct,
  fitPoints,
  gap,
  gapLabel,
  percentile,
  projectFinish,
  sayDoRatio,
  sprintStatus,
  velocity,
} from "@/lib/sprints/metrics";

const done = (id: string, endDate: string, pointsCompleted?: number): Sprint => ({
  id,
  name: id,
  startDate: endDate.replace(/-\d{2}$/, "-01"),
  endDate,
  pointsPlanned: 30,
  pointsCompleted,
  status: "completed",
});

describe("velocity", () => {
  it("averages the latest three finished sprints by end date, whatever the stored order", () => {
    // Stored newest first: the old recentVelocity took the last three rows (the oldest).
    const sprints = [
      done("d", "2026-10-31", 40),
      done("c", "2026-09-30", 30),
      done("b", "2026-08-31", 20),
      done("a", "2026-07-31", 10),
    ];
    expect(DEFAULT_VELOCITY_WINDOW).toBe(3);
    expect(velocity(sprints)).toEqual({
      average: 30,
      count: 3,
      points: [20, 30, 40],
      sprintIds: ["b", "c", "d"],
    });
  });

  it("can order by start date, and takes any window", () => {
    const early = { ...done("x", "2026-12-31", 50), startDate: "2026-06-01" };
    const sprints = [done("a", "2026-09-30", 10), done("b", "2026-10-31", 20), early];
    expect(velocity(sprints, { window: 1 }).sprintIds).toEqual(["x"]);
    expect(velocity(sprints, { window: 1, by: "startDate" }).sprintIds).toEqual(["b"]);
    expect(velocity(sprints, { window: Number.POSITIVE_INFINITY }).count).toBe(3);
    expect(velocity(sprints, { window: 100 }).average).toBe(26.7);
    expect(velocity(sprints, { window: 2.9 }).count).toBe(2);
  });

  it("uses the default window for a window under one sprint or not a number", () => {
    const sprints = [1, 2, 3, 4, 5].map((i) => done(`s${i}`, `2026-0${i}-28`, i * 10));
    expect(velocity(sprints, { window: 0 }).count).toBe(3);
    expect(velocity(sprints, { window: -2 }).count).toBe(3);
    expect(velocity(sprints, { window: Number.NaN }).count).toBe(3);
  });

  it("leaves out unfinished sprints and ones without completed points", () => {
    const active: Sprint = { ...done("act", "2026-12-31", 99), status: "active" };
    const sprints = [done("a", "2026-09-30"), active, done("b", "2026-10-31", 0)];
    expect(velocity(sprints)).toMatchObject({ average: 0, count: 1, sprintIds: ["b"] });
    expect(velocity([])).toEqual({ average: null, count: 0, points: [], sprintIds: [] });
  });

  it("counts undated sprints as the oldest and keeps stored order on ties", () => {
    const undated = { ...done("u", "x", 99), startDate: "", endDate: "" };
    const sprints = [done("b", "2026-10-31", 20), undated, done("a", "2026-10-31", 10)];
    expect(velocity(sprints, { window: 2 }).sprintIds).toEqual(["b", "a"]);
    expect(velocity(sprints, { window: 3 }).sprintIds).toEqual(["u", "b", "a"]);
  });

  it("copes with huge numbers and long histories", () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      done(`s${i}`, new Date(Date.UTC(2000, 0, 1 + i * 14)).toISOString().slice(0, 10), 1e9)
    );
    expect(velocity(many).average).toBe(1e9);
    expect(velocity(many).sprintIds).toEqual(["s4997", "s4998", "s4999"]);
  });
});

describe("sayDoRatio", () => {
  it("grades delivery against the commitment", () => {
    expect(sayDoRatio(40, 40)).toEqual({ ratio: 1, pct: 100, grade: "met", score: 1 });
    expect(sayDoRatio(40, 36)?.grade).toBe("met"); // 90% is the edge of met
    expect(sayDoRatio(40, 44)?.grade).toBe("met"); // so is 110%
    expect(sayDoRatio(40, 35)?.grade).toBe("close");
    expect(sayDoRatio(40, 28)?.grade).toBe("close"); // 70%
    expect(sayDoRatio(40, 27)?.grade).toBe("missed");
    expect(sayDoRatio(40, 45)?.grade).toBe("over");
  });

  it("scores closeness either way, never below 0", () => {
    expect(sayDoRatio(40, 30)?.score).toBeCloseTo(0.75);
    expect(sayDoRatio(40, 50)?.score).toBeCloseTo(0.75);
    expect(sayDoRatio(40, 0)).toMatchObject({ ratio: 0, pct: 0, grade: "missed", score: 0 });
    expect(sayDoRatio(10, 1000)).toMatchObject({ grade: "over", score: 0, pct: 10000 });
  });

  it("is null without a commitment or a completed number", () => {
    expect(sayDoRatio(0, 10)).toBeNull();
    expect(sayDoRatio(-5, 10)).toBeNull();
    expect(sayDoRatio(Number.NaN, 10)).toBeNull();
    expect(sayDoRatio(20, undefined)).toBeNull();
    expect(sayDoRatio(20, null)).toBeNull();
    expect(sayDoRatio(20, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("reads negative completed points as none", () => {
    expect(sayDoRatio(20, -4)).toMatchObject({ ratio: 0, grade: "missed" });
  });
});

describe("projectFinish", () => {
  it("finds where a falling trend reaches 0", () => {
    expect(projectFinish([40, 30, 20])).toBe(4);
    expect(projectFinish([40, 37, 37, 35, 31])).toBe(20);
  });

  it("finds where a rising trend reaches a target (burnup)", () => {
    expect(projectFinish([0, 5, 10], { target: 30 })).toBe(6);
  });

  it("takes explicit x positions (working days)", () => {
    const pts = [
      { x: 0, y: 30 },
      { x: 2, y: 20 },
      { x: 2, y: 20 },
      { x: 4, y: 10 },
    ];
    expect(projectFinish(pts)).toBe(6);
  });

  it("is the latest x once the target is reached", () => {
    expect(projectFinish([10, 4, 0])).toBe(2);
    expect(projectFinish([0, 12, 31], { target: 30 })).toBe(2);
  });

  it("is null for a flat trend, one going the wrong way, or too few points", () => {
    expect(projectFinish([20, 20, 20])).toBeNull();
    expect(projectFinish([20, 22, 25])).toBeNull();
    expect(projectFinish([0, 0, 1], { target: 0 })).toBeNull();
    expect(projectFinish([20])).toBeNull();
    expect(projectFinish([])).toBeNull();
  });

  it("ignores readings that aren't numbers", () => {
    expect(projectFinish([40, Number.NaN, 20])).toBe(
      projectFinish([
        { x: 0, y: 40 },
        { x: 2, y: 20 },
      ])
    );
  });

  it("handles huge values", () => {
    expect(projectFinish([3e12, 2e12, 1e12])).toBe(3);
  });

  it("fits a straight line through points", () => {
    expect(fitPoints([])).toEqual({ slope: 0, intercept: 0 });
    expect(fitPoints([{ x: 3, y: 7 }])).toEqual({ slope: 0, intercept: 7 });
    expect(
      fitPoints([
        { x: 1, y: 2 },
        { x: 1, y: 4 },
      ])
    ).toEqual({ slope: 0, intercept: 3 });
    const f = fitPoints([
      { x: 0, y: 1 },
      { x: 2, y: 5 },
    ]);
    expect(f.slope).toBeCloseTo(2);
    expect(f.intercept).toBeCloseTo(1);
  });
});

describe("percentile", () => {
  it("is the nearest rank: the smallest value with p% at or below it", () => {
    const v = [9, 1, 5, 3, 7, 2, 8, 4, 6, 10];
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 85)).toBe(9);
    expect(percentile(v, 95)).toBe(10);
    expect(percentile(v, 10)).toBe(1);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });

  it("clamps p and handles one value, zeros and huge values", () => {
    expect(percentile([4, 8], 0)).toBe(4);
    expect(percentile([4, 8], 100)).toBe(8);
    expect(percentile([4, 8], 250)).toBe(8);
    expect(percentile([4, 8], -10)).toBe(4);
    expect(percentile([7], 85)).toBe(7);
    expect(percentile([0, 0, 0], 85)).toBe(0);
    expect(percentile([1e15, 2e15], 50)).toBe(1e15);
  });

  it("is null for no values or a p that isn't a number, and skips non-numbers", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2], Number.NaN)).toBeNull();
    expect(percentile([Number.NaN, 3, Number.POSITIVE_INFINITY], 50)).toBe(3);
  });

  it("doesn't reorder the caller's array", () => {
    const v = [3, 1, 2];
    percentile(v, 50);
    expect(v).toEqual([3, 1, 2]);
  });
});

describe("completionPct", () => {
  it("is done over the current scope, whole and within 0–100", () => {
    expect(completionPct(13, 44)).toBe(30);
    expect(completionPct(0, 44)).toBe(0);
    expect(completionPct(50, 40)).toBe(100);
    expect(completionPct(-3, 40)).toBe(0);
    expect(completionPct(1, 3e12)).toBe(0);
  });

  it("is null without a scope", () => {
    expect(completionPct(5, 0)).toBeNull();
    expect(completionPct(5, -1)).toBeNull();
    expect(completionPct(Number.NaN, 10)).toBeNull();
  });
});

describe("gap", () => {
  it("is remaining minus ideal, positive when behind", () => {
    expect(gap(27, 24)).toBe(3);
    expect(gap(6, 10)).toBe(-4);
    expect(gap(10, 10)).toBe(0);
    expect(gap(10.04, 10)).toBe(0);
    expect(Object.is(gap(9.97, 10), -0)).toBe(false);
  });

  it("says behind by / ahead by", () => {
    expect(gapLabel(3)).toBe("Behind by 3 points");
    expect(gapLabel(-1)).toBe("Ahead by 1 point");
    expect(gapLabel(-1.26)).toBe("Ahead by 1.3 points");
    expect(gapLabel(0)).toBe("On the ideal line");
    expect(gapLabel(2, { one: "story", many: "stories" })).toBe("Behind by 2 stories");
  });
});

describe("sprintStatus with a working calendar", () => {
  // Monday 5 Oct to Friday 16 Oct 2026: 9 working days.
  const sprint: Sprint = {
    id: "s1",
    name: "Sprint 1",
    startDate: "2026-10-05",
    endDate: "2026-10-16",
    pointsPlanned: 45,
    status: "active",
  };
  const series: SprintSeries = {
    id: "s1",
    days: [
      { day: 0, remaining: 45 },
      { day: 5, remaining: 25 }, // Saturday: Mon–Fri done
      { day: 7, remaining: 25 }, // Monday morning
    ],
  };

  it("measures the gap against the working-day ideal", () => {
    const status = sprintStatus(sprint, series, { calendar: DEFAULT_CALENDAR });
    expect(status.idealRemaining).toBe(20);
    expect(status.gap).toBe(5);
    expect(status.onTrack).toBe(false);
    // Calendar days: the ideal on day 7 is 45 × 4/11.
    expect(sprintStatus(sprint, series).idealRemaining).toBe(16.4);
  });

  it("projects the finish on working days and maps it back to a calendar day", () => {
    const status = sprintStatus(sprint, series, { calendar: DEFAULT_CALENDAR });
    // The trend reaches 0 after 12.1 working days: the morning after the
    // 13th, Thursday 22 Oct, which is calendar day 17 (past the end, day 11).
    expect(status.projectedFinishDay).toBe(17);
    expect(status.willFinishOnTime).toBe(false);
  });

  it("knows a finished sprint is finished", () => {
    const finished: SprintSeries = {
      id: "s1",
      days: [
        { day: 0, remaining: 45 },
        { day: 4, remaining: 0 },
      ],
    };
    const status = sprintStatus(sprint, finished);
    expect(status.projectedFinishDay).toBe(4);
    expect(status.willFinishOnTime).toBe(true);
    expect(status.percentDone).toBe(100);
  });
});
