import type { Sprint, SprintGoal } from "@/lib/stores/workspace-types";
import { listAnd } from "@/lib/charts/chart-text";
import { goalSmart, smartMissing, validateSmart } from "./smart";
import { outcomeClause } from "./outcome";

/**
 * The one-sentence answer above the wizard: how the goal sentence does on
 * SMART, and how many of its acceptance criteria pass every check. The
 * criteria clause names its own bar ("pass every check"), so it never
 * reads as if the criteria met the goal's partial score.
 *
 * Once the team has answered "Did we meet the sprint goal?", that answer
 * leads: after the sprint it is the result that matters, and the SMART
 * line stays as how well the goal was written.
 */
export function goalVerdict(
  goal: Pick<SprintGoal, "goal" | "businessObjective" | "criteria" | "okrIds"> &
    Partial<Pick<SprintGoal, "outcome">>,
  sprint?: Pick<Sprint, "id" | "name">
): string {
  const answer = goal.outcome ? outcomeClause(goal.outcome.met, sprint?.name) : "";
  if (!goal.goal.trim()) {
    if (answer) return `${answer}; no goal statement is written here.`;
    const who = sprint ? `${sprint.name} has no goal yet` : "No goal yet";
    return `${who}: write the one outcome the team commits to.`;
  }
  const smart = smartVerdict(goal, sprint);
  return answer ? `${answer}. ${smart}` : smart;
}

function smartVerdict(
  goal: Pick<SprintGoal, "goal" | "businessObjective" | "criteria" | "okrIds">,
  sprint?: Pick<Sprint, "id" | "name">
): string {
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
    const all =
      n === 1
        ? "its acceptance criterion passes"
        : n === 2
          ? "both acceptance criteria pass"
          : `all ${n} acceptance criteria pass`;
    return `${lead}, and ${all} every check.`;
  }
  if (passing === 0) {
    return n === 1
      ? `${lead}, but its acceptance criterion doesn't pass every check yet.`
      : `${lead}, but none of its ${n} acceptance criteria passes every check yet.`;
  }
  return `${lead}, and ${passing} of ${n} acceptance criteria ${passing === 1 ? "passes" : "pass"} every check.`;
}
