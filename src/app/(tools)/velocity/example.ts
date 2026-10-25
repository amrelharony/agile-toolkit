import { exampleId } from "@/components/tool-frame/example-data";
import type { CapacityMember, CapacityPlan } from "@/lib/stores/workspace-types";
import { exampleSprints, type ExampleSprints } from "@/lib/sprints/example";
import { capacityPlanIdFor } from "@/lib/sprints/capacity";
import { todayIso } from "@/lib/sprints/series";

/**
 * Velocity's example, shown in memory only (fake finished sprints would
 * feed forecasts, the dashboard and agents): the shared example sprints
 * (four finished, 29, 31, 30 and 33 points, and one running), each finished
 * one with its own capacity plan, so the points per person-day show.
 *
 * Five people on ten-day sprints. In Sprint 3 a developer and the
 * half-time product owner were each away for a week, so its 30 points came
 * from 34.5 person-days against Sprint 2's 31 from 42.2: the velocity
 * dipped while the points per person-day rose (0.87 against 0.73).
 */
export interface VelocityExample extends ExampleSprints {
  capacityPlans: CapacityPlan[];
}

const TEAM: Omit<CapacityMember, "id" | "daysOff">[] = [
  { name: "Priya", role: "Product Owner", availability: 50 },
  { name: "Diego", role: "Developer", availability: 100 },
  { name: "Mei", role: "Developer", availability: 100 },
  { name: "Sam", role: "Developer", availability: 80 },
  { name: "Amara", role: "QA Engineer", availability: 100 },
];

/** Days off per person, per finished example sprint (TEAM order). */
const DAYS_OFF = [
  [0, 1, 0, 0, 2],
  [0, 0, 0, 1, 0],
  [5, 5, 0, 0, 1],
  [0, 0, 1, 0, 0],
];

export function buildExample(today: string = todayIso()): VelocityExample {
  const base = exampleSprints(today);
  const finished = base.sprints.filter((s) => s.status === "completed");
  const capacityPlans: CapacityPlan[] = finished.map((sprint, i) => ({
    id: capacityPlanIdFor(sprint.id),
    sprintId: sprint.id,
    members: TEAM.map((m, j) => ({
      ...m,
      id: exampleId(`velocity-member-${i + 1}-${j + 1}`),
      daysOff: DAYS_OFF[i]?.[j] ?? 0,
    })),
    config: {
      sprintDays: 10,
      ceremonyOverhead: 10,
      focusFactor: 0.8,
      hoursPerDay: 6,
      pointsCommitted: String(sprint.pointsPlanned),
    },
  }));
  return { ...base, capacityPlans };
}
