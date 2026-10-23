/**
 * Where the Release Planner's velocities come from, and its start date.
 *
 * "sprints": the completed points of the shared sprints that are done,
 * oldest first by end date. A sprint that finished with 0 points counts: it
 * is what the team delivered, and leaving it out made every forecast
 * optimistic. "manual": the numbers typed in the box, which stays as an
 * override. Until the user picks one, the planner reads typed numbers when
 * there are some and the sprints otherwise.
 *
 * The headline velocity is the shared definition (`velocity` in
 * lib/sprints/metrics: the latest three sprints), so it matches Velocity,
 * the Sprint Cockpit and the dashboard. The Monte Carlo draws from every
 * sprint in the sample, since a forecast needs the spread, not one average.
 */

import type { Sprint } from "@/lib/stores/workspace-types";
import { velocity, type Velocity } from "@/lib/sprints/metrics";
import { endDateFor, hasSyntheticDates, todayIso } from "@/lib/sprints/series";
import type { Validation } from "@/lib/utils/form";

export type VelocitySource = "manual" | "sprints";

/**
 * Version 0's starter numbers in the box. They read as real history, so a
 * box that still holds them counts as empty (see store.ts).
 */
export const LEGACY_STARTER_VELOCITIES = "18, 22, 19, 25, 21, 17, 23, 20";

const squash = (s: string) => s.replace(/\s+/g, "");

/** True while the box holds version 0's starter numbers or nothing at all. */
export function isStarterVelocityInput(input: string): boolean {
  const v = squash(input ?? "");
  return v === "" || v === squash(LEGACY_STARTER_VELOCITIES);
}

/** The pieces of a typed list: numbers separated by commas, semicolons, spaces or lines. */
function tokens(input: string): string[] {
  return (input ?? "")
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Points per sprint from a typed list, zeros included; anything else is left out. */
export function parseVelocities(input: string): number[] {
  return tokens(input)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/**
 * A typed list checked before it is saved: every piece must be a number of
 * points, 0 or more. An empty box is valid (nothing typed yet).
 */
export function validateVelocities(input: string): Validation<number[], "velocities"> {
  const bad = tokens(input).filter((t) => {
    const n = Number(t);
    return !Number.isFinite(n) || n < 0;
  });
  if (bad.length === 0) return { ok: true, values: parseVelocities(input) };
  const shown = bad
    .slice(0, 3)
    .map((t) => `“${t}”`)
    .join(", ");
  return {
    ok: false,
    errors: {
      velocities: `${shown} ${bad.length === 1 ? "isn't" : "aren't"} a number of points. Use numbers of 0 or more, such as 18, 22, 0.`,
    },
  };
}

/** Every completed sprint with completed points, oldest first by end date (zeros included). */
export function sprintSample(sprints: readonly Sprint[]): Velocity {
  return velocity(sprints, { window: Number.POSITIVE_INFINITY });
}

/** Completed points of finished sprints, oldest first by end date; a 0 is kept. */
export function sprintVelocities(sprints: readonly Sprint[]): number[] {
  return sprintSample(sprints).points;
}

/** Typed numbers as stand-in sprints, so the shared definition reads them in typed order. */
function typedSprints(values: readonly number[]): Sprint[] {
  return values.map((pointsCompleted, i) => ({
    id: `typed-${i + 1}`,
    name: `Sprint ${i + 1}`,
    startDate: "",
    endDate: "",
    pointsPlanned: 0,
    pointsCompleted,
    status: "completed",
  }));
}

/** The headline velocity: the shared definition over the sprints, or the typed list (oldest first). */
export function headlineVelocity(
  source: VelocitySource,
  sprints: readonly Sprint[],
  typed: readonly number[]
): Velocity {
  return source === "sprints" ? velocity(sprints) : velocity(typedSprints(typed));
}

/** The source in use: the user's choice, else typed numbers if there are any, else the sprints. */
export function resolveVelocitySource(config: {
  velocitySource?: VelocitySource;
  velocityInput: string;
}): VelocitySource {
  if (config.velocitySource === "manual" || config.velocitySource === "sprints") {
    return config.velocitySource;
  }
  return !isStarterVelocityInput(config.velocityInput) &&
    parseVelocities(config.velocityInput).length > 0
    ? "manual"
    : "sprints";
}

/**
 * The start date to plan from: the one the user set, else the day after the
 * active sprint ends, else today.
 */
export function effectiveStartDate(
  configured: string | undefined,
  activeSprint: Sprint | undefined,
  today: string = todayIso()
): { date: string; from: "user" | "sprint" | "today" } {
  if (configured && /^\d{4}-\d{2}-\d{2}$/.test(configured)) {
    return { date: configured, from: "user" };
  }
  if (activeSprint && !hasSyntheticDates(activeSprint)) {
    const next = endDateFor(activeSprint.endDate.slice(0, 10), 1);
    if (next) return { date: next, from: "sprint" };
  }
  return { date: today, from: "today" };
}
