/**
 * The Phase 5 additions to lib/sprints/metrics: end-date order, pointed
 * sprints, a rolling velocity and predictability from the graded say/do.
 */

import { describe, expect, it } from "vitest";
import type { Sprint } from "@/lib/stores/workspace-types";
import {
  isPointedSprint,
  predictability,
  rollingVelocity,
  sprintsByEndDate,
  velocity,
} from "@/lib/sprints/metrics";

const sprint = (
  id: string,
  end: string,
  planned: number,
  done?: number,
  over: Partial<Sprint> = {}
): Sprint => ({
  id,
  name: id.toUpperCase(),
  startDate: "2026-01-01",
  endDate: end,
  pointsPlanned: planned,
  ...(done !== undefined ? { pointsCompleted: done } : {}),
  status: done === undefined ? "active" : "completed",
  ...over,
});

describe("sprintsByEndDate", () => {
  it("orders by end date, oldest first, undated first, ties in stored order", () => {
    const list = [
      sprint("c", "2026-03-01", 10, 10),
      sprint("a", "2026-01-15", 10, 10),
      sprint("x", "", 10, 10, { startDate: "" }),
      sprint("b", "2026-01-15", 10, 10),
    ];
    expect(sprintsByEndDate(list).map((s) => s.id)).toEqual(["x", "a", "b", "c"]);
  });
});

describe("isPointedSprint", () => {
  it("needs a finished sprint with a positive commitment and a completed number", () => {
    expect(isPointedSprint(sprint("a", "2026-01-15", 10, 8))).toBe(true);
    expect(isPointedSprint(sprint("b", "2026-01-15", 0, 8))).toBe(false);
    expect(isPointedSprint(sprint("c", "2026-01-15", 10))).toBe(false);
  });
});

describe("rollingVelocity", () => {
  it("averages each finished sprint with the ones before it, up to the window", () => {
    const list = [
      sprint("s3", "2026-03-01", 10, 30),
      sprint("s1", "2026-01-01", 10, 10),
      sprint("s2", "2026-02-01", 10, 20),
      sprint("s4", "2026-04-01", 10, 40),
      sprint("open", "2026-05-01", 10),
    ];
    expect(rollingVelocity(list, 3)).toEqual([
      { sprintId: "s1", average: 10 },
      { sprintId: "s2", average: 15 },
      { sprintId: "s3", average: 20 },
      { sprintId: "s4", average: 30 },
    ]);
    // The last point is the shared velocity.
    expect(rollingVelocity(list, 3).at(-1)?.average).toBe(velocity(list).average);
  });
});

describe("predictability", () => {
  it("counts the met sprints of the latest pointed ones and grades each", () => {
    const list = [
      sprint("s1", "2026-01-01", 20, 20), // met
      sprint("s2", "2026-02-01", 20, 15), // close (75%)
      sprint("s3", "2026-03-01", 20, 10), // missed
      sprint("s4", "2026-04-01", 20, 25), // over (125%)
      sprint("zero", "2026-04-15", 0, 5), // unpointed: left out
    ];
    const p = predictability(list);
    expect(p.count).toBe(4);
    expect(p.byGrade).toEqual({ met: 1, close: 1, missed: 1, over: 1 });
    expect(p.pct).toBe(25);
    expect(p.meanSayDoPct).toBe(Math.round((100 + 75 + 50 + 125) / 4));
    expect(p.sprints.map((s) => s.sprintId)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(predictability(list, { window: 2 }).sprints.map((s) => s.sprintId)).toEqual([
      "s3",
      "s4",
    ]);
  });

  it("says nothing without pointed sprints", () => {
    expect(predictability([sprint("open", "2026-01-01", 10)])).toMatchObject({
      pct: null,
      meanSayDoPct: null,
      count: 0,
    });
  });
});
