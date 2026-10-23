import { describe, expect, it } from "vitest";
import { effectiveHours, planCapacity } from "@/lib/sprints/capacity";

const config = { sprintDays: 10, hoursPerDay: 8, focusFactor: 0.8, ceremonyOverhead: 15 };

describe("capacity maths", () => {
  it("works a person's effective hours out as the planner always has", () => {
    // 9 working days × 80% × 8 h × 0.8 focus × 85% after ceremonies
    expect(effectiveHours({ availability: 80, daysOff: 1 }, config)).toBeCloseTo(39.168, 3);
    expect(effectiveHours({ availability: 100, daysOff: 12 }, config)).toBe(0);
  });

  it("sums the plan and rounds for display", () => {
    const summary = planCapacity({
      members: [
        { id: "m1", name: "Ann", role: "Dev", availability: 80, daysOff: 1 },
        { id: "m2", name: "Bob", role: "QA", availability: 100, daysOff: 0 },
      ],
      config: { ...config, pointsCommitted: "" },
    });
    expect(summary.perMember.map((m) => m.effectiveHours)).toEqual([39.2, 54.4]);
    expect(summary.totalHours).toBe(93.6);
    expect(summary.avgAvailability).toBe(90);
    expect(summary.totalDaysOff).toBe(1);
  });
});
