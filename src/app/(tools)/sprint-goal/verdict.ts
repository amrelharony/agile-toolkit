import type { Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import { listAnd } from "@/lib/charts/chart-text";
import { goalSmart, smartMissing, validateSmart } from "./smart";

/**
 * The one-sentence answer above the wizard: how the goal sentence does on
 * SMART, and how many of its acceptance criteria pass every check.
 */
export function goalVerdict(
  goal: Pick<SprintGoal, "goal" | "businessObjective" | "criteria" | "okrIds">,
  sprint?: Pick<Sprint, "id" | "name">
): string {
  if (!goal.goal.trim()) {
    const who = sprint ? `${sprint.name} has no goal yet` : "No goal yet";
    return `${who}: write the one outcome the team commits to.`;
  }
  const missing = smartMissing(goalSmart(goal, sprint));
  const lead =
    missing.length === 0
      ? "The goal meets all five SMART checks"
      : `The goal meets ${5 - missing.length} of 5 SMART checks (missing ${listAnd(missing)})`;

  const criteria = goal.criteria.filter((c) => c.text.trim());
  const n = criteria.length;
  if (n === 0) return `${lead}, but it has no acceptance criteria yet.`;
  const passing = criteria.filter((c) => smartMissing(validateSmart(c)).length === 0).length;
  if (passing === n) {
    return n === 1
      ? `${lead}, and so does its acceptance criterion.`
      : `${lead}, and so do all ${n} acceptance criteria.`;
  }
  if (passing === 0) {
    return n === 1
      ? `${lead}, but its acceptance criterion doesn't yet.`
      : `${lead}, but none of its ${n} acceptance criteria do yet.`;
  }
  return `${lead}, and ${passing} of ${n} acceptance criteria ${passing === 1 ? "does" : "do"}.`;
}
