/**
 * The capacity maths, pure, so the Capacity Planner and the Sprint Planning
 * flow agree to the hour (moved here from the planner's folder so both
 * import it from lib).
 *
 * A person's effective hours are their working days (sprint days minus
 * days off) × availability × hours per day × focus factor × (1 − ceremony
 * overhead).
 */

import type {
  CapacityMember,
  CapacityConfig,
  CapacityPlan,
  Sprint,
} from "@/lib/stores/workspace-types";
import { velocity, type VelocityOptions } from "./metrics";

/**
 * A Capacity Planner example row: an `example-` id, the rule of
 * components/tool-frame/example-data isExampleId (a test holds the two
 * together). Not imported from there: that is a "use client" module, and
 * in the MCP route handler its exports are client references that throw
 * when an agent action calls them (as lib/flow notes).
 */
const isExampleId = (id: string | null | undefined) =>
  typeof id === "string" && id.startsWith("example-");

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

/* ── Velocity per available person-day ───────────────────────────────── */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The person-days a plan's team had: each member's working days (the
 * plan's sprint days, which already leave out team holidays, minus their
 * days off) times their availability. The Capacity Planner's example rows
 * (`example-` ids) don't count, unless `includeExamples` (a tool's own
 * in-memory example). To one decimal.
 */
export function availablePersonDays(
  plan: Pick<CapacityPlan, "members" | "config">,
  { includeExamples = false }: { includeExamples?: boolean } = {}
): number {
  const days = Number.isFinite(plan.config?.sprintDays) ? plan.config.sprintDays : 0;
  let total = 0;
  for (const m of plan.members ?? []) {
    if (!includeExamples && isExampleId(m.id)) continue;
    const off = Number.isFinite(m.daysOff) ? m.daysOff : 0;
    const share = Number.isFinite(m.availability) ? Math.max(0, m.availability) / 100 : 0;
    total += Math.max(days - off, 0) * share;
  }
  return round1(total);
}

export interface PerPersonDay {
  sprintId: string;
  /** Completed points. */
  points: number;
  personDays: number;
  /** Points per available person-day, to two decimals. */
  perDay: number;
}

export interface VelocityPerPersonDay {
  /** The finished sprints in the window that had their own capacity plan, oldest first. */
  perSprint: PerPersonDay[];
  /** Σ points ÷ Σ person-days over them, to two decimals; null with none. */
  average: number | null;
  /** How many sprints went into it. */
  count: number;
}

/**
 * Completed points per available person-day, over the finished sprints in
 * velocity's window (`opts`, as `velocity` takes it) that had their own
 * capacity plan. The `capacity-planner:current` fallback isn't that
 * sprint's plan, so it doesn't count; nor does a plan with no person-days.
 * The average is a ratio of sums, so a short sprint doesn't weigh as much
 * as a full one.
 */
export function velocityPerPersonDay(
  sprints: readonly Sprint[],
  plans: readonly CapacityPlan[] | undefined,
  { includeExamples = false, ...opts }: VelocityOptions & { includeExamples?: boolean } = {}
): VelocityPerPersonDay {
  const v = velocity(sprints, opts);
  const perSprint: PerPersonDay[] = [];
  v.sprintIds.forEach((sprintId, i) => {
    const found = findCapacityPlan(plans, sprintId);
    if (!found?.perSprint) return;
    const personDays = availablePersonDays(found.plan, { includeExamples });
    if (!(personDays > 0)) return;
    const points = v.points[i];
    perSprint.push({ sprintId, points, personDays, perDay: round2(points / personDays) });
  });
  const days = perSprint.reduce((a, p) => a + p.personDays, 0);
  const done = perSprint.reduce((a, p) => a + p.points, 0);
  return {
    perSprint,
    average: perSprint.length > 0 && days > 0 ? round2(done / days) : null,
    count: perSprint.length,
  };
}
