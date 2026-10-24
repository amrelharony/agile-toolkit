/**
 * One way to score a squad health check, shared by the tools that read it:
 * Sprint Comparison's quality, the Health Dashboard's team health and, in
 * Phase 6, the Health Check page. Pure.
 *
 * A light is worth 1 for green, ½ for yellow and 0 for red, as the Health
 * Dashboard already counted it (green 2, yellow 1, red 0 out of 2), so a
 * squad that is "a bit worried" about a dimension doesn't score the same
 * as one in trouble.
 */

import type {
  HealthCheck,
  HealthCheckEntry,
  HealthDimension,
  HealthDimensionScore,
  HealthTrafficLight,
  Sprint,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_DIMENSIONS } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";
import { retroSprintFor } from "@/lib/retro/board";

export const LIGHT_VALUE: Readonly<Record<HealthTrafficLight, number>> = {
  green: 1,
  yellow: 0.5,
  red: 0,
};

/** The dimensions that speak to quality: the code and how easily it ships. */
export const QUALITY_DIMENSIONS: readonly HealthDimension[] = [
  "Health of Codebase",
  "Easy to Release",
];

/**
 * The share of health, 0 to 1, over `dims` (all eight by default): the mean
 * light value of the dimensions that were scored. Null when none of them was.
 */
export function healthShare(
  scores: Partial<Record<HealthDimension, HealthDimensionScore>> | undefined,
  dims: readonly HealthDimension[] = HEALTH_CHECK_DIMENSIONS
): number | null {
  let sum = 0;
  let n = 0;
  for (const d of dims) {
    const light = scores?.[d]?.light;
    if (light === undefined || !(light in LIGHT_VALUE)) continue;
    sum += LIGHT_VALUE[light];
    n++;
  }
  return n === 0 ? null : sum / n;
}

/** Saved checks the team made: the history, never the draft in progress, without examples. */
function savedChecks(doc: HealthCheck | undefined): HealthCheckEntry[] {
  return (doc?.history ?? []).filter((e) => !isExampleId(e.id));
}

/** The newest saved check (by its date, then its place in the history), or null. */
export function latestSavedCheck(doc: HealthCheck | undefined): HealthCheckEntry | null {
  let best: HealthCheckEntry | null = null;
  for (const e of savedChecks(doc)) {
    if (!best || (e.date ?? "") >= (best.date ?? "")) best = e;
  }
  return best;
}

const nameKey = (name: string | undefined) => (name ?? "").trim().toLowerCase();

/**
 * The saved check for `sprint`: one named like the sprint (case and spaces
 * aside), else one taken on a day whose retro looks back on it (the retro
 * window: the sprint's first day to a week after its last). The newest if
 * several match.
 */
export function healthCheckFor(
  doc: HealthCheck | undefined,
  sprint: Pick<Sprint, "id" | "name">,
  sprints: readonly Sprint[]
): HealthCheckEntry | undefined {
  const checks = savedChecks(doc);
  const newest = (xs: HealthCheckEntry[]) =>
    xs.reduce<HealthCheckEntry | undefined>(
      (best, e) => (!best || (e.date ?? "") >= (best.date ?? "") ? e : best),
      undefined
    );
  const key = nameKey(sprint.name);
  const named = key ? checks.filter((e) => nameKey(e.sprintName) === key) : [];
  if (named.length > 0) return newest(named);
  return newest(
    checks.filter((e) => e.date && retroSprintFor(e.date.slice(0, 10), sprints)?.id === sprint.id)
  );
}
