import { describe, expect, it } from "vitest";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { sprintStatus } from "@/lib/sprints/metrics";
import {
  averageVelocity,
  completedSprints,
  hubTiles,
  migratedSourceNames,
  sprintDayLine,
  sprintNudges,
  suggestedCompletedPoints,
  toolStatusLines,
} from "@/app/(tools)/sprint-metrics/view";

/** The hub's wording, without rendering: day line, tiles, status lines, nudges. */

const sprint = (partial: Partial<Sprint> = {}): Sprint => ({
  id: "s",
  name: "Sprint",
  startDate: "2026-10-05",
  endDate: "2026-10-15",
  pointsPlanned: 20,
  status: "active",
  ...partial,
});

describe("day line", () => {
  it("places today in the sprint, before it or after it", () => {
    const s = sprint();
    expect(sprintDayLine(s, "2026-10-05")).toBe("Day 0 of 10");
    expect(sprintDayLine(s, "2026-10-09")).toBe("Day 4 of 10");
    expect(sprintDayLine(s, "2026-10-04")).toBe("Starts in 1 day");
    expect(sprintDayLine(s, "2026-10-18")).toBe("Ended 3 days ago");
    expect(sprintDayLine(sprint({ startDate: "2020-01-02", endDate: "" }), "2026-10-09")).toBe(
      "No dates set"
    );
  });
});

describe("tiles", () => {
  it("call a sprint ahead of the ideal line ahead", () => {
    const s = sprint();
    // Ideal on day 5 is 10; 6 left is 4 ahead.
    const series: SprintSeries = {
      id: "s",
      days: [
        { day: 0, remaining: 20 },
        { day: 5, remaining: 6 },
      ],
    };
    const tiles = hubTiles(s, sprintStatus(s, series), { average: null, count: 0 });
    const gap = tiles.find((t) => t.id === "gap");
    expect(gap).toMatchObject({ value: "Ahead by 4 points", tone: "success" });
    expect(tiles.find((t) => t.id === "average")).toMatchObject({
      value: "No history yet",
      empty: true,
    });
  });

  it("show a closed sprint's points when nothing was logged", () => {
    const s = sprint({ status: "completed", pointsCompleted: 18 });
    const tiles = hubTiles(s, sprintStatus(s, undefined), { average: null, count: 0 });
    expect(tiles.find((t) => t.id === "done")).toMatchObject({
      value: "18",
      hint: "When the sprint closed",
    });
    expect(tiles.find((t) => t.id === "remaining")).toMatchObject({ value: "Not logged yet" });
  });
});

describe("averages", () => {
  it("leave the sprint itself out of its own comparison", () => {
    const done = (id: string, start: string, points: number): Sprint =>
      sprint({
        id,
        startDate: start,
        endDate: start,
        status: "completed",
        pointsCompleted: points,
      });
    const completed = completedSprints([
      done("a", "2026-08-01", 20),
      done("b", "2026-08-15", 24),
      done("c", "2026-09-01", 28),
      sprint({ id: "open", status: "active" }),
    ]);
    expect(completed.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(averageVelocity(completed)).toEqual({ average: 24, count: 3 });
    expect(averageVelocity(completed, "c")).toEqual({ average: 22, count: 2 });
    expect(averageVelocity([])).toEqual({ average: null, count: 0 });
  });

  it("feed the Velocity and Release Planner cards", () => {
    const lines = toolStatusLines(sprintStatus(sprint(), undefined), { average: 24, count: 3 });
    expect(lines.velocity).toBe("Average 24 points over 3 sprints");
    expect(lines["release-planner"]).toBe("Ready to forecast from your last 3 sprints");
    expect(lines.burndown).toBe("Not logged yet");
  });
});

describe("closing and nudges", () => {
  it("suggests completed points from the log, else what's stored", () => {
    const s = sprint({ pointsCompleted: 9 });
    const series: SprintSeries = { id: "s", days: [{ day: 3, completed: 12 }] };
    expect(suggestedCompletedPoints(s, series)).toEqual({ points: 12, fromDay: 3 });
    expect(suggestedCompletedPoints(s, undefined)).toEqual({ points: 9, fromDay: null });
    expect(suggestedCompletedPoints(sprint(), undefined)).toEqual({ points: null, fromDay: null });
  });

  it("flags each data problem, and a checked migration only once", () => {
    const s = sprint({ status: "completed", startDate: "2020-01-04", endDate: "" });
    const series: SprintSeries = { id: "s", migratedFrom: ["velocity"] };
    expect(sprintNudges(s, series)).toEqual(["no-points", "synthetic-dates", "migrated"]);
    expect(sprintNudges(s, series, new Set(["s"]))).toEqual(["no-points", "synthetic-dates"]);
    expect(sprintNudges(sprint(), undefined)).toEqual([]);
  });

  it("names where a migrated sprint came from", () => {
    expect(migratedSourceNames(["burndown"])).toBe("Burndown");
    expect(migratedSourceNames(["burndown", "burnup", "compare"])).toBe(
      "Burndown, Burnup and Sprint Comparison"
    );
    expect(migratedSourceNames([])).toBe("older tool data");
  });
});
