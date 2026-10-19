import { describe, expect, it } from "vitest";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import {
  averageRating,
  completedAt,
  dayDate,
  dayForDate,
  endDateFor,
  hasSyntheticDates,
  lastLoggedDay,
  remainingAt,
  scopeAt,
  seriesFor,
  sprintLengthDays,
  sprintsNewestFirst,
  statusFromDates,
  withDay,
  withRatings,
  withoutDay,
} from "@/lib/sprints/series";
import { exampleSprints, isExampleSprintId } from "@/lib/sprints/example";

const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  pointsPlanned: 40,
  status: "active",
};
const NOW = "2026-10-19T09:00:00.000Z";

describe("dates", () => {
  it("counts calendar days from the start", () => {
    expect(sprintLengthDays(SPRINT)).toBe(11);
    expect(dayDate(SPRINT, 0)).toBe("2026-10-05");
    expect(dayDate(SPRINT, 11)).toBe("2026-10-16");
    expect(dayForDate(SPRINT, "2026-10-08")).toBe(3);
    expect(endDateFor("2026-10-30", 3)).toBe("2026-11-02");
  });

  it("falls back to 10 days and flags sprints without real dates", () => {
    const bridged = { ...SPRINT, startDate: "2020-01-03", endDate: "" };
    expect(sprintLengthDays(bridged)).toBe(10);
    expect(hasSyntheticDates(bridged)).toBe(true);
    expect(hasSyntheticDates({ ...SPRINT, startDate: "2020-01-02", endDate: "2020-01-12" })).toBe(
      true
    );
    expect(hasSyntheticDates(SPRINT)).toBe(false);
    expect(dayDate({ startDate: "" }, 2)).toBeNull();
  });

  it("derives status from the dates", () => {
    expect(statusFromDates(SPRINT, "2026-10-01")).toBe("planned");
    expect(statusFromDates(SPRINT, "2026-10-10")).toBe("active");
    expect(statusFromDates(SPRINT, "2026-10-16")).toBe("active");
    expect(statusFromDates(SPRINT, "2026-10-17")).toBe("completed");
  });

  it("orders sprints newest first, undated last", () => {
    const old = { ...SPRINT, id: "a", name: "Old", startDate: "2026-09-01" };
    const undated = { ...SPRINT, id: "b", name: "Undated", startDate: "" };
    expect(sprintsNewestFirst([old, undated, SPRINT]).map((s) => s.id)).toEqual(["s1", "a", "b"]);
  });
});

describe("the daily log", () => {
  it("sets, clears and drops days, keeping them sorted", () => {
    let s: SprintSeries = seriesFor([], "s1");
    expect(s).toEqual({ id: "s1" });
    s = withDay(s, 2, { remaining: 30 }, NOW);
    s = withDay(s, 0, { remaining: 40 }, NOW);
    s = withDay(s, 2, { note: "Blocked on API" }, NOW);
    expect(s.days).toEqual([
      { day: 0, remaining: 40 },
      { day: 2, remaining: 30, note: "Blocked on API" },
    ]);
    expect(s.updatedAt).toBe(NOW);

    s = withDay(s, 2, { remaining: undefined, note: undefined }, NOW);
    expect(s.days).toEqual([{ day: 0, remaining: 40 }]);
    expect(withoutDay(s, 0, NOW).days).toEqual([]);
  });

  it("derives the number the other tool didn't type", () => {
    const s: SprintSeries = {
      id: "s1",
      days: [
        { day: 0, remaining: 40 },
        { day: 1, completed: 6 },
        { day: 2, completed: 9, scope: 45 },
        { day: 3, remaining: 30 },
      ],
    };
    expect(scopeAt(SPRINT, s, 1)).toBe(40);
    expect(scopeAt(SPRINT, s, 3)).toBe(45);
    expect(remainingAt(SPRINT, s, 1)).toBe(34);
    expect(remainingAt(SPRINT, s, 2)).toBe(36);
    expect(completedAt(SPRINT, s, 0)).toBe(0);
    expect(completedAt(SPRINT, s, 3)).toBe(15);
    expect(remainingAt(SPRINT, s, 4)).toBeNull();
    expect(lastLoggedDay(s)).toBe(3);
  });

  it("merges ratings and averages them", () => {
    let s = withRatings({ id: "s1" }, { Velocity: 7, Quality: 8 }, NOW);
    s = withRatings(s, { Quality: undefined, Predictability: 6 }, NOW);
    expect(s.ratings).toEqual({ Velocity: 7, Predictability: 6 });
    expect(averageRating(s)).toBe(6.5);
    expect(averageRating({ id: "x" })).toBeNull();
  });
});

describe("example sprints", () => {
  it("puts the current sprint on day 5 today, with finished sprints before it", () => {
    const ex = exampleSprints("2026-10-19");
    expect(ex.current.startDate).toBe("2026-10-14");
    expect(ex.current.status).toBe("active");
    expect(ex.sprints.filter((s) => s.status === "completed")).toHaveLength(4);
    expect(ex.sprints.every((s) => isExampleSprintId(s.id))).toBe(true);
    const current = ex.series.find((s) => s.id === ex.current.id);
    expect(lastLoggedDay(current)).toBe(5);
    expect(ex.series.filter((s) => s.ratings).length).toBe(4);
  });
});
