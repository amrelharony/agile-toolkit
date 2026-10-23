/**
 * Where a sprint goal lives, shared by the Sprint Goal page and the
 * tool.sprint_goal.* agent actions so both read and write the same document.
 *
 * Each sprint has its own document under `sprint-goal:sprint:<sprintId>`
 * (with `sprintId` set), and its goal statement is mirrored to
 * `Sprint.goal`. `sprint-goal:current` keeps its old meaning: the one goal
 * from before goals were per sprint, now the draft for when no sprint is
 * chosen.
 */

import type { SprintGoal, SprintGoalOutcome } from "@/lib/stores/workspace-types";

export const DRAFT_GOAL_ID = "sprint-goal:current";
export const SPRINT_GOAL_PREFIX = "sprint-goal:sprint:";

/** The document id for `sprintId`'s goal, or the draft's. */
export function goalDocId(sprintId?: string | null): string {
  return sprintId ? `${SPRINT_GOAL_PREFIX}${sprintId}` : DRAFT_GOAL_ID;
}

/** A goal with nothing in it yet. */
export function blankGoal(sprintId?: string | null): SprintGoal {
  return {
    id: goalDocId(sprintId),
    businessObjective: "",
    goal: "",
    criteria: [],
    keyResults: [],
    ...(sprintId ? { sprintId } : {}),
  };
}

export const GOAL_OUTCOMES: readonly SprintGoalOutcome["met"][] = ["met", "partly", "not-met"];

export const GOAL_OUTCOME_LABEL: Record<SprintGoalOutcome["met"], string> = {
  met: "Met",
  partly: "Partly met",
  "not-met": "Not met",
};
