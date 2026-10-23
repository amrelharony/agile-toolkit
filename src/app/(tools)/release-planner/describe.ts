/**
 * The inputs in words, shared by the page and the Markdown export, so both
 * name the same source, sample and counts.
 */

import { fmt, listAnd, plural } from "@/lib/charts/chart-text";
import type { ResolvedScope } from "./scope-source";
import type { ReleasePlan } from "./plan";

/** "14 open stories, 2 without points" — what the scope was counted from. */
export function scopeItemsText(scope: ResolvedScope): string {
  if (scope.source === "typed") return "typed";
  const noun =
    scope.source === "backlog"
      ? plural(scope.items, "open story", "open stories")
      : plural(scope.items, "card");
  if (scope.unestimated === 0) return noun;
  const missing = scope.source === "backlog" ? "without points" : "without a numeric estimate";
  return `${noun}, ${fmt(scope.unestimated)} ${missing}`;
}

/** "2 open stories have no points, so the forecast leaves them out." */
export function unestimatedText(scope: ResolvedScope): string {
  const n = scope.unestimated;
  const one = n === 1;
  return scope.source === "backlog"
    ? `${plural(n, "open story", "open stories")} ${one ? "has" : "have"} no points, so the forecast leaves ${one ? "it" : "them"} out.`
    : `${plural(n, "card")} ${one ? "has" : "have"} no numeric estimate, so the forecast leaves ${one ? "it" : "them"} out.`;
}

/** "120 points from the backlog (14 open stories, 2 without points)". */
export function scopeText(scope: ResolvedScope): string {
  if (scope.points === null) return "Not set";
  const pts = plural(scope.points, "point");
  if (scope.source === "typed") return `${pts}, typed`;
  const from =
    scope.source === "backlog" ? "the backlog" : `the story-map slice “${scope.slice?.name ?? ""}”`;
  return `${pts} from ${from} (${scopeItemsText(scope)})`;
}

/** Names of the sampled sprints, shortened past six: "Sprint 1, Sprint 2 … Sprint 9". */
function sampleNames(labels: readonly string[]): string {
  if (labels.length <= 6) return listAnd([...labels]);
  return `${labels.slice(0, 2).join(", ")} … ${labels[labels.length - 1]}`;
}

/** "8 completed sprints (Sprint 1, Sprint 2 … Sprint 8): 20, 0, 22, …". */
export function sampleText(plan: Pick<ReleasePlan, "sample" | "velocitySource">): string {
  const { points, labels } = plan.sample;
  if (points.length === 0) return "None yet";
  const list = points.map((p) => fmt(p)).join(", ");
  return plan.velocitySource === "sprints"
    ? `${plural(points.length, "completed sprint")} (${sampleNames(labels)}): ${list}`
    : `${plural(points.length, "typed velocity", "typed velocities")}: ${list}`;
}

/** "21 points per sprint, the average of the last 3 sprints". */
export function headlineText(plan: Pick<ReleasePlan, "headline">): string {
  const v = plan.headline;
  if (v.average === null) return "Not enough data";
  const over = v.count === 1 ? "the last sprint" : `the average of the last ${v.count} sprints`;
  return `${fmt(v.average)} points per sprint, ${over}`;
}

/** "14 days (the team's cadence)". */
export function lengthText(plan: Pick<ReleasePlan, "lengthDays" | "lengthFrom">): string {
  return `${plural(plan.lengthDays, "day")}${plan.lengthFrom === "cadence" ? " (the team's cadence)" : ""}`;
}
