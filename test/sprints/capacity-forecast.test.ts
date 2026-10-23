import { describe, expect, it } from "vitest";
import {
  CAPACITY_PLAN_ID,
  capacityPlanIdFor,
  findCapacityPlan,
  normalHours,
  planCapacity,
  pointsForecast,
} from "@/lib/sprints/capacity";
import type { CapacityPlan } from "@/lib/stores/workspace-types";

/** Capacity plans per sprint, and the points a sprint's capacity suggests. */

const plan = (id: string, members: { availability: number; daysOff: number }[]): CapacityPlan => ({
  id,
  members: members.map((m, i) => ({ id: `m${i}`, name: `P${i}`, role: "Dev", ...m })),
  config: {
    sprintDays: 10,
    ceremonyOverhead: 10,
    focusFactor: 0.8,
    hoursPerDay: 8,
    pointsCommitted: "",
  },
});

describe("per-sprint capacity plans", () => {
  it("names plans by sprint, with the current plan as the fallback id", () => {
    expect(capacityPlanIdFor("s1")).toBe("capacity-planner:sprint:s1");
    expect(capacityPlanIdFor(undefined)).toBe(CAPACITY_PLAN_ID);
    expect(capacityPlanIdFor("")).toBe(CAPACITY_PLAN_ID);
  });

  it("finds the sprint's own plan, else falls back to the current one", () => {
    const current = plan(CAPACITY_PLAN_ID, []);
    const own = plan(capacityPlanIdFor("s1"), []);
    expect(findCapacityPlan([current, own], "s1")).toEqual({ plan: own, perSprint: true });
    expect(findCapacityPlan([current, own], "s2")).toEqual({ plan: current, perSprint: false });
    expect(findCapacityPlan([own], "s2")).toBeUndefined();
    expect(findCapacityPlan(undefined, "s1")).toBeUndefined();
  });
});

describe("points forecast", () => {
  it("measures a normal sprint as everyone fully available", () => {
    // 10 days × 8 h × 0.8 focus × 0.9 after ceremonies = 57.6 h each.
    expect(
      normalHours(
        plan("p", [
          { availability: 50, daysOff: 3 },
          { availability: 100, daysOff: 0 },
        ])
      )
    ).toBe(115.2);
    expect(normalHours(plan("p", []))).toBe(0);
  });

  it("scales velocity by this sprint's share of a normal sprint", () => {
    // One person off 2 of 10 days: 80% + 100% of normal → 90%.
    const p = plan("p", [
      { availability: 100, daysOff: 2 },
      { availability: 100, daysOff: 0 },
    ]);
    expect(planCapacity(p).totalHours).toBe(103.7);
    expect(pointsForecast(p, 30)).toEqual({ ratio: 0.9, points: 27 });
  });

  it("gives no points without velocity or capacity, and no ratio without a plan", () => {
    const p = plan("p", [{ availability: 100, daysOff: 0 }]);
    expect(pointsForecast(p, null)).toEqual({ ratio: 1, points: null });
    expect(pointsForecast(p, 0)).toEqual({ ratio: 1, points: null });
    expect(pointsForecast(plan("p", []), 30)).toEqual({ ratio: null, points: null });
    expect(pointsForecast(undefined, 30)).toEqual({ ratio: null, points: null });
  });
});
