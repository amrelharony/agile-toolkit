/**
 * Where the Release Planner's velocities come from, and its start date.
 *
 * "sprints": the completed points of the shared sprints that are done
 * (`selectCompletedSprints`, oldest first). "manual": the numbers typed in
 * the Historical Velocities box, which stays as an override. Until the user
 * picks one, the planner uses the sprints once there are three of them and
 * the box still holds the starter numbers (or nothing).
 */

import type { Sprint } from "@/lib/stores/workspace-types";
import { endDateFor, hasSyntheticDates, todayIso } from "@/lib/sprints/series";

export type VelocitySource = "manual" | "sprints";

/** The starter numbers in the Historical Velocities box. */
export const DEFAULT_VELOCITY_INPUT = "18, 22, 19, 25, 21, 17, 23, 20";

/** Completed sprints needed before the planner reads them on its own. */
export const MIN_SPRINTS_FOR_AUTO = 3;

/** Positive numbers from a comma- or line-separated list. */
export function parseVelocities(input: string): number[] {
  return input
    .split(/[\n,]+/)
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n) && n > 0);
}

/** Completed points of finished sprints, in the order given; sprints with none are skipped. */
export function sprintVelocities(completedSprints: readonly Sprint[]): number[] {
  return completedSprints
    .map((s) => s.pointsCompleted)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** True while the box holds the starter numbers or nothing at all. */
export function isDefaultVelocityInput(input: string): boolean {
  const v = squash(input ?? "");
  return v === "" || v === squash(DEFAULT_VELOCITY_INPUT);
}

/** The source in use: the user's choice, else "sprints" when there are enough and nothing was typed. */
export function resolveVelocitySource(
  config: { velocitySource?: VelocitySource; velocityInput: string },
  fromSprints: readonly number[]
): VelocitySource {
  if (config.velocitySource === "manual" || config.velocitySource === "sprints") {
    return config.velocitySource;
  }
  return fromSprints.length >= MIN_SPRINTS_FOR_AUTO && isDefaultVelocityInput(config.velocityInput)
    ? "sprints"
    : "manual";
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
