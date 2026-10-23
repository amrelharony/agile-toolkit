import type { NextStep } from "@/lib/tools/next-steps";
import { plural } from "@/lib/charts/chart-text";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import type { ReleasePlan } from "./plan";

/**
 * Where the forecast should send the team next, from what is weakest in
 * it: points missing from the scope, too little history, or a target date
 * that is a long shot. Null when the forecast stands on its own.
 *
 * Rendered inline under the result (the page's own data drives it: the
 * scope source, the sample and the target date aren't workspace state the
 * shared next-step rules can see).
 */
export function releaseNextStep(plan: ReleasePlan): NextStep | null {
  const { scope } = plan;
  if (scope.source === "backlog" && scope.unestimated > 0) {
    return {
      id: "release-estimate-stories",
      label: "Estimate the unsized stories",
      detail: `Size ${scope.unestimated === 1 ? "the story" : `the ${plural(scope.unestimated, "story", "stories")}`} without points, so the forecast covers the whole backlog.`,
      href: "/planning-poker",
    };
  }
  if (scope.source === "slice" && scope.slice && scope.unestimated > 0) {
    return {
      id: "release-estimate-slice",
      label: "Estimate the slice's cards",
      detail: `${plural(scope.unestimated, "card")} in “${scope.slice.name}” ${scope.unestimated === 1 ? "has" : "have"} no numeric estimate. Send ${scope.unestimated === 1 ? "it" : "them"} to Planning Poker from the Story Mapper.`,
      href: "/story-mapper",
    };
  }
  if (
    plan.velocitySource === "sprints" &&
    (plan.blocked === "no-sample" || plan.blocked === "small-sample")
  ) {
    return {
      id: "release-log-sprints",
      label: "Close sprints with their points",
      detail: `The forecast samples completed sprints and needs at least ${MIN_SAMPLE.forecast}; it has ${plan.sample.points.length}.`,
      href: "/velocity",
    };
  }
  // The rounded chance, as the page shows it: "50%" isn't a long shot. Only
  // with a forecast: a blocked plan's verdict already says what to fix.
  const chance = plan.target?.chance;
  if (
    !plan.blocked &&
    plan.target &&
    plan.target.sprints >= 1 &&
    chance != null &&
    Math.round(chance * 100) < 50
  ) {
    return {
      id: "release-cut-scope",
      label: "Decide what to cut",
      detail: `The target date is a long shot. Sort the release scope into Must, Should and Could, and keep the Musts within what the team can promise.`,
      href: "/moscow",
    };
  }
  return null;
}
