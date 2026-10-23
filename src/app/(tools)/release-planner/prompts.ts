import { generateReleasePlannerPrompts } from "@/lib/ai-prompts/release-planner";
import type { PromptDefinition } from "@/lib/ai-prompts/types";
import { fmt } from "@/lib/charts/chart-text";
import type { ReleasePlan } from "./plan";

const AVERAGE_LINE = /^Average Velocity: .*$/m;

/**
 * The AI prompts for this forecast, from the same plan the page shows.
 *
 * The shared generator still names a buffer and an adjustment: the one
 * expected change rides in the buffer, so the numbers stay right. It also
 * averages every velocity it is given, while the page's velocity is the
 * shared definition (the latest three sprints): its "Average Velocity"
 * line is replaced with the page's number, so the prompt and the page
 * agree. (Passing the headline to the generator would be the clean fix;
 * it lives in lib/ai-prompts.)
 */
export function releasePrompts(plan: ReleasePlan): PromptDefinition[] {
  const [p50, p75, p85, p95] = plan.rows.map((r) => r.sprints);
  const results =
    p50 != null && p75 != null && p85 != null && p95 != null ? { p50, p75, p85, p95 } : null;
  const prompts = generateReleasePlannerPrompts({
    config: {
      backlogSize: plan.scope.points ?? 0,
      velocityInput: plan.sample.points.join(", "),
      scopeBuffer: plan.scopeChangePct ?? 0,
      scopeAdjustment: 0,
      sprintLengthDays: plan.lengthDays,
      startDate: plan.start.date,
    },
    results,
  });
  const { average, count } = plan.headline;
  if (average === null) return prompts;
  const over = count === 1 ? "the last sprint" : `the last ${count} sprints`;
  const line = `Average Velocity: ${fmt(average)} pts/sprint (${over}, as the Release Planner shows it)`;
  return prompts.map((p) => ({ ...p, prompt: p.prompt.replace(AVERAGE_LINE, line) }));
}
