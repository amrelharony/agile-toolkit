/**
 * The capacity maths, pure, so the planner page and the Sprint Planning
 * flow agree to the hour.
 *
 * A person's effective hours are their working days (sprint days minus
 * days off) × availability × hours per day × focus factor × (1 − ceremony
 * overhead).
 */

import type { CapacityMember, CapacityConfig, CapacityPlan } from "@/lib/stores/workspace-types";

export type CapacityMemberInput = Pick<CapacityMember, "availability" | "daysOff">;
export type CapacityConfigInput = Pick<
  CapacityConfig,
  "sprintDays" | "ceremonyOverhead" | "focusFactor" | "hoursPerDay"
>;

/** MUST match CP_ID in capacity-planner-client.tsx and actions/tools/capacity-planner.ts. */
export const CAPACITY_PLAN_ID = "capacity-planner:current";

export function effectiveHours(member: CapacityMemberInput, config: CapacityConfigInput): number {
  const workingDays = Math.max(config.sprintDays - member.daysOff, 0);
  return (
    workingDays *
    (member.availability / 100) *
    config.hoursPerDay *
    config.focusFactor *
    (1 - config.ceremonyOverhead / 100)
  );
}

export interface CapacitySummary {
  perMember: { id: string; name: string; effectiveHours: number }[];
  totalHours: number;
  avgAvailability: number;
  totalDaysOff: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The plan's totals, as the planner's summary cards show them. */
export function planCapacity(plan: Pick<CapacityPlan, "members" | "config">): CapacitySummary {
  const perMember = plan.members.map((m) => ({
    id: m.id,
    name: m.name,
    effectiveHours: round1(effectiveHours(m, plan.config)),
  }));
  const totalHours = round1(perMember.reduce((sum, m) => sum + m.effectiveHours, 0));
  const avgAvailability =
    plan.members.length > 0
      ? round1(plan.members.reduce((sum, m) => sum + m.availability, 0) / plan.members.length)
      : 0;
  const totalDaysOff = plan.members.reduce((sum, m) => sum + m.daysOff, 0);
  return { perMember, totalHours, avgAvailability, totalDaysOff };
}
