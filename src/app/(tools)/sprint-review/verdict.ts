import type { Sprint, SprintGoalOutcome, SprintReview } from "@/lib/stores/workspace-types";
import type { ReviewFacts } from "@/lib/sprints/review-doc";
import { fmt } from "@/lib/charts/chart-text";
import { contentSummary, reviewHasContent } from "./doc";
import type { ReviewNumbers } from "./numbers";

const GOAL_CLAUSE: Record<SprintGoalOutcome["met"], (name: string) => string> = {
  met: (name) => `${name} met its goal`,
  partly: (name) => `${name} partly met its goal`,
  "not-met": (name) => `${name} didn't meet its goal`,
};

/** "8 of 10 stories done, 34 of 40 points"; "" when there is nothing to count. */
export function numbersClause(n: ReviewNumbers): string {
  const parts: string[] = [];
  if (n.storyCount > 0) {
    parts.push(
      `${n.doneCount} of ${n.storyCount} ${n.storyCount === 1 ? "story" : "stories"} done`
    );
  }
  const withStories = parts.length > 0;
  if (n.committed > 0 && n.completed !== null) {
    parts.push(`${fmt(n.completed)} of ${fmt(n.committed)} points${withStories ? "" : " done"}`);
  } else if (n.committed > 0) {
    parts.push(`${fmt(n.committed)} points committed`);
  } else if ((n.completed ?? 0) > 0) {
    parts.push(`${fmt(n.completed ?? 0)} points done`);
  }
  return parts.join(", ");
}

/**
 * The one sentence above the tabs: whether the sprint met its goal (the
 * answer recorded in Sprint Goal), then what got done.
 *
 *   "Sprint 12 met its goal: 8 of 10 stories done, 34 of 40 points."
 */
export function reviewVerdict({
  doc,
  sprint,
  facts,
  numbers,
}: {
  doc: SprintReview;
  sprint?: Pick<Sprint, "name">;
  facts: ReviewFacts | null;
  numbers: ReviewNumbers;
}): string {
  const nums = numbersClause(numbers);
  if (sprint) {
    const outcome = facts?.goalOutcome;
    if (outcome) {
      const lead = GOAL_CLAUSE[outcome.met](sprint.name);
      return nums ? `${lead}: ${nums}.` : `${lead}.`;
    }
    if (nums) {
      return facts?.goal
        ? `${sprint.name}: ${nums}; “Did we meet the sprint goal?” isn't answered yet.`
        : `${sprint.name}: ${nums}.`;
    }
    return facts?.goal
      ? `${sprint.name} has a goal but no stories or points yet.`
      : `${sprint.name} has no goal, stories or points yet.`;
  }
  const name = doc.sprintName.trim();
  if (nums) return `${name || "This review"}: ${nums}.`;
  if (reviewHasContent(doc)) return `The draft holds ${contentSummary(doc)}.`;
  return "Nothing in this review yet: add what you'll demo, then capture the stakeholders' feedback.";
}
