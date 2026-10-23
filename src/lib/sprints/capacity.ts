/**
 * The capacity maths, pure, so the Capacity Planner and the Sprint Planning
 * flow agree to the hour (moved here from the planner's folder so both
 * import it from lib).
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

/** The per-sprint plan's id; without a sprint, the `capacity-planner:current` fallback. */
export function capacityPlanIdFor(sprintId?: string | null): string {
  return sprintId ? `capacity-planner:sprint:${sprintId}` : CAPACITY_PLAN_ID;
}

/**
 * The plan for `sprintId`: its own plan when one was made, else the
 * `capacity-planner:current` fallback (which every team had before plans
 * were per sprint), else undefined.
 */
export function findCapacityPlan<P extends Pick<CapacityPlan, "id">>(
  plans: readonly P[] | undefined,
  sprintId?: string | null
): { plan: P; perSprint: boolean } | undefined {
  const list = plans ?? [];
  if (sprintId) {
    const own = list.find((p) => p.id === capacityPlanIdFor(sprintId));
    if (own) return { plan: own, perSprint: true };
  }
  const fallback = list.find((p) => p.id === CAPACITY_PLAN_ID);
  return fallback ? { plan: fallback, perSprint: false } : undefined;
}

/** Hours if everyone were fully available with no days off: the "normal" sprint. */
export function normalHours(plan: Pick<CapacityPlan, "members" | "config">): number {
  const perPerson = effectiveHours({ availability: 100, daysOff: 0 }, plan.config);
  return round1(perPerson * plan.members.length);
}

export interface PointsForecast {
  /** This sprint's hours as a share of a normal sprint (0..1+), or null with no plan hours. */
  ratio: number | null;
  /** Velocity scaled by that share, rounded to a whole point; null without both. */
  points: number | null;
}

/**
 * How many points to plan: recent velocity scaled by how much of a normal
 * sprint the team has this time ("capacity is 85% of normal, so suggest
 * 26 points"). Null when there's no velocity or no capacity plan to scale by.
 */
export function pointsForecast(
  plan: Pick<CapacityPlan, "members" | "config"> | undefined,
  velocity: number | null | undefined
): PointsForecast {
  if (!plan) return { ratio: null, points: null };
  const normal = normalHours(plan);
  const ratio = normal > 0 ? planCapacity(plan).totalHours / normal : null;
  const points =
    ratio !== null && typeof velocity === "number" && Number.isFinite(velocity) && velocity > 0
      ? Math.round(velocity * ratio)
      : null;
  return { ratio: ratio === null ? null : Math.round(ratio * 100) / 100, points };
}
