import { MIN_SAMPLE, needMore } from "@/lib/analytics/min-sample";
import { fmt, plural } from "@/lib/charts/chart-text";
import { formatDay, MAX_SPRINTS } from "./forecast";
import type { ReleasePlan } from "./plan";

/** "an 8%", "a 64%": the article English uses before the spoken number. */
function aPct(n: number): string {
  const an = n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89);
  return `${an ? "an" : "a"} ${n}%`;
}

/** "all 132 points", or "the 132 estimated points" when some items have no estimate. */
function scopePhrase(plan: ReleasePlan): string {
  const n = plan.effective ?? 0;
  if (plan.scope.unestimated > 0) return `the ${fmt(n)} estimated ${n === 1 ? "point" : "points"}`;
  return `all ${plural(n, "point")}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const sprintsOf = (n: number) => plural(n, "sprint");

/** Why there's nothing to forecast, as an instruction. */
function blockedVerdict(plan: ReleasePlan): string {
  const { scope } = plan;
  switch (plan.blocked) {
    case "no-scope":
      if (scope.source === "backlog" && scope.items > 0) {
        return `None of the ${plural(scope.items, "open story", "open stories")} has points yet, so there's nothing to forecast.`;
      }
      if (scope.source === "slice") {
        if (scope.slice && scope.items > 0) {
          return `None of the ${plural(scope.items, "card")} in “${scope.slice.name}” has a numeric estimate yet, so there's nothing to forecast.`;
        }
        return scope.slice
          ? `“${scope.slice.name}” has no cards yet, so there's nothing to forecast.`
          : "Pick a story-map slice to get a forecast.";
      }
      return "Add the release scope to get a forecast.";
    case "no-sample":
      return plan.velocitySource === "sprints"
        ? "Close a sprint with its completed points to get a forecast."
        : "Type the points of a few past sprints to get a forecast.";
    case "small-sample": {
      const more = needMore(plan.sample.points.length, "forecast");
      return plan.velocitySource === "sprints"
        ? `A forecast needs at least ${MIN_SAMPLE.forecast} sprints of history: close ${plural(more, "more sprint")} with ${more === 1 ? "its" : "their"} points.`
        : `A forecast needs at least ${MIN_SAMPLE.forecast} sprints of history: type ${plural(more, "more velocity", "more velocities")}.`;
    }
    case "no-progress":
      return "Every sampled sprint delivered 0 points, so at this pace the release never finishes.";
    case "beyond-cap":
      return `At this pace most runs need more than ${MAX_SPRINTS} sprints: check the scope, or split the release.`;
    default:
      return "";
  }
}

/**
 * The one-sentence answer above the forecast: the date to plan for, or the
 * chance of the target date and what to do about a long shot.
 */
export function releaseVerdict(plan: ReleasePlan): string {
  if (plan.blocked) return blockedVerdict(plan);
  const f = plan.forecast;
  if (!f) return "";
  const p85 = plan.rows.find((r) => r.pct === 85);
  const p50 = plan.rows.find((r) => r.pct === 50);
  const what = scopePhrase(plan);
  const t = plan.target;

  if (t) {
    const by = formatDay(t.date);
    if (t.sprints === 0) {
      const lead = `No full sprint fits between the start (${formatDay(plan.start.date)}) and ${by}`;
      return p85?.sprints
        ? `${lead}; plan for ${formatDay(p85.date)} to be 85% sure of finishing ${what}.`
        : `${lead}.`;
    }
    const pct = Math.round(t.chance * 100);
    const promise = t.deliverable ? fmt(Math.floor(t.deliverable.p85), 0) : null;
    if (t.chance >= 0.995) return `Very likely: almost every run finishes ${what} by ${by}.`;
    if (t.chance >= 0.85) return `Likely: ${aPct(pct)} chance of finishing ${what} by ${by}.`;
    // Short of 85%: the two ways to get there, a later date or less scope.
    const options = [
      p85?.sprints ? `plan for ${formatDay(p85.date)}` : null,
      promise && Number(promise) < (plan.effective ?? 0) ? `cut to about ${promise} points` : null,
    ].filter(Boolean);
    const lead =
      t.chance >= 0.5
        ? capitalize(`${aPct(pct)} chance of finishing ${what} by ${by}`)
        : t.chance < 0.005
          ? `Very unlikely: almost no run finishes ${what} by ${by}`
          : `Unlikely: ${aPct(pct)} chance of finishing ${what} by ${by}`;
    return options.length > 0 ? `${lead}; to be 85% sure, ${options.join(" or ")}.` : `${lead}.`;
  }

  if (p85?.sprints && p50?.sprints) {
    const half =
      p50.sprints === p85.sprints ? "" : `; half the runs finish by ${formatDay(p50.date)}`;
    return `Plan for ${formatDay(p85.date)} (${sprintsOf(p85.sprints)}) to be 85% sure of finishing ${what}${half}.`;
  }
  if (p50?.sprints) {
    return `Half the runs finish ${what} by ${formatDay(p50.date)}, but more than 15% don't finish within ${MAX_SPRINTS} sprints.`;
  }
  return "";
}
