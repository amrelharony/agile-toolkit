/**
 * Sprint progress from the stories: scope, done and remaining points with
 * counts by status, what carries over, and "points left today" from the
 * stories when they are pointed, else from the typed daily log.
 */

import { describe, expect, it } from "vitest";
import type { Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { carryOver, remainingToday, storyProgress } from "@/lib/sprints/progress";

const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-05",
  endDate: "2026-10-16",
  pointsPlanned: 30,
  status: "active",
};

const st = (id: string, status: Story["status"], points?: number, over: Partial<Story> = {}) =>
  ({
    id,
    title: id,
    status,
    sprintId: "s1",
    ...(points === undefined ? {} : { points }),
    ...over,
  }) as Story;

const STORIES: Story[] = [
  st("a", "done", 8),
  st("b", "review", 5),
  st("c", "in_progress", 3, { blocked: true }),
  st("d", "todo", 2.5),
  st("e", "todo"), // not estimated yet
  st("f", "done", 1, { blocked: true }), // a stale flag on a done story
  st("x", "todo", 13, { sprintId: "s2" }), // another sprint
  st("y", "backlog", 20, { sprintId: undefined }),
];

describe("storyProgress", () => {
  it("adds up the sprint's stories by status", () => {
    const p = storyProgress(STORIES, "s1");
    expect(p).toMatchObject({
      count: 6,
      scope: 19.5,
      done: 9,
      remaining: 10.5,
      doneCount: 2,
      unestimated: 1,
      blocked: 1,
    });
    expect(p.byStatus).toEqual({
      backlog: { count: 0, points: 0 },
      todo: { count: 2, points: 2.5 },
      in_progress: { count: 1, points: 3 },
      review: { count: 1, points: 5 },
      done: { count: 2, points: 9 },
    });
  });

  it("is all zeros for a sprint with no stories", () => {
    const p = storyProgress(STORIES, "nope");
    expect(p).toMatchObject({ count: 0, scope: 0, done: 0, remaining: 0, unestimated: 0 });
    expect(storyProgress([], "s1").byStatus.done).toEqual({ count: 0, points: 0 });
  });

  it("rounds float sums and copes with huge points", () => {
    const tenths = Array.from({ length: 10 }, (_, i) => st(`t${i}`, "done", 0.1));
    expect(storyProgress(tenths, "s1").done).toBe(1);
    expect(storyProgress([st("h", "todo", 1e12), st("i", "done", 1e12)], "s1")).toMatchObject({
      scope: 2e12,
      remaining: 1e12,
    });
  });

  it("treats points that aren't numbers as unestimated", () => {
    const odd = [st("n", "todo", Number.NaN), st("m", "todo", 0)];
    expect(storyProgress(odd, "s1")).toMatchObject({ scope: 0, unestimated: 1, count: 2 });
  });
});

describe("carryOver", () => {
  it("is the sprint's unfinished stories and their points", () => {
    const c = carryOver(SPRINT, STORIES);
    expect(c.stories.map((s) => s.id)).toEqual(["b", "c", "d", "e"]);
    expect(c.points).toBe(10.5);
  });

  it("is empty when everything is done or nothing is planned", () => {
    expect(carryOver(SPRINT, [st("a", "done", 3)])).toEqual({ stories: [], points: 0 });
    expect(carryOver(SPRINT, [])).toEqual({ stories: [], points: 0 });
  });
});

describe("remainingToday", () => {
  const SERIES: SprintSeries = {
    id: "s1",
    days: [
      { day: 0, remaining: 30 },
      { day: 2, remaining: 24 },
      { day: 6, completed: 20 }, // a Burnup reading: 30 − 20
    ],
  };

  it("prefers the stories when the sprint has pointed ones", () => {
    expect(
      remainingToday({ sprint: SPRINT, stories: STORIES, series: SERIES, today: "2026-10-08" })
    ).toEqual({ remaining: 10.5, source: "stories" });
  });

  it("falls back to the latest logged reading on or before today", () => {
    const unpointed = [st("e", "todo")];
    expect(
      remainingToday({ sprint: SPRINT, stories: unpointed, series: SERIES, today: "2026-10-08" })
    ).toEqual({ remaining: 24, source: "log", day: 2 });
    expect(
      remainingToday({ sprint: SPRINT, stories: [], series: SERIES, today: "2026-10-30" })
    ).toEqual({ remaining: 10, source: "log", day: 6 });
  });

  it("says nothing before the first reading, or with neither stories nor a log", () => {
    expect(
      remainingToday({ sprint: SPRINT, stories: [], series: SERIES, today: "2026-10-01" })
    ).toEqual({ remaining: null, source: "none" });
    expect(
      remainingToday({ sprint: SPRINT, stories: [], series: undefined, today: "2026-10-08" })
    ).toEqual({ remaining: null, source: "none" });
  });

  it("reads 0 from the stories once every pointed story is done", () => {
    expect(
      remainingToday({ sprint: SPRINT, stories: [st("a", "done", 5)], series: SERIES })
    ).toEqual({ remaining: 0, source: "stories" });
  });

  it("uses any reading when the sprint has no dates", () => {
    const undated = { ...SPRINT, startDate: "" };
    expect(
      remainingToday({ sprint: undated, stories: [], series: SERIES, today: "2026-10-08" })
    ).toEqual({ remaining: 10, source: "log", day: 6 });
  });
});
