/**
 * Where a sprint review lives, and what it can say without anyone typing
 * it. Shared by the Sprint Review page, the cockpit and the
 * tool.sprint_review.* agent actions.
 *
 * Each sprint has its own document under `sprint-review:sprint:<sprintId>`
 * (with `sprintId` set). `sprint-review:current` keeps its old meaning: the
 * one review from before reviews were per sprint, now the draft for when no
 * sprint is chosen.
 */

import type {
  Sprint,
  SprintGoal,
  SprintGoalOutcome,
  SprintReview,
  Story,
} from "@/lib/stores/workspace-types";
import { goalDocId } from "./goal-doc";
import { sayDoRatio, type SayDo } from "./metrics";
import { storyProgress } from "./progress";

export const DRAFT_REVIEW_ID = "sprint-review:current";
export const SPRINT_REVIEW_PREFIX = "sprint-review:sprint:";

/** The document id for `sprintId`'s review, or the draft's. */
export function reviewDocId(sprintId?: string | null): string {
  return sprintId ? `${SPRINT_REVIEW_PREFIX}${sprintId}` : DRAFT_REVIEW_ID;
}

/** A review with nothing in it yet; a sprint's takes its name. */
export function blankReview(sprint?: Pick<Sprint, "id" | "name"> | null): SprintReview {
  return {
    id: reviewDocId(sprint?.id),
    ...(sprint ? { sprintId: sprint.id } : {}),
    sprintName: sprint?.name ?? "",
    sprintNumber: "",
    features: [],
    meetingDate: "",
    feedbackItems: [],
    checklistItems: [],
    committed: 0,
    completed: 0,
    totalBacklog: 0,
    backlogDone: 0,
  };
}

/** Whether a review has anything in it beyond its sprint's name. */
export function reviewHasContent(r: SprintReview | undefined | null): boolean {
  return Boolean(
    r && (r.features.length > 0 || r.feedbackItems.length > 0 || r.checklistItems.length > 0)
  );
}

const GOAL_MET = new Set(["met", "partly", "not-met"]);

export interface ReviewFacts {
  /** The sprint goal: its goal document's statement, else `Sprint.goal`. */
  goal: string | null;
  /** The answer to "Did we meet the sprint goal?", from Sprint Goal. */
  goalOutcome: SprintGoalOutcome | null;
  /** Done stories, in stored order: the demo candidates. */
  done: Story[];
  /** Planned stories that aren't done. */
  notDone: Story[];
  /** Points planned into the sprint (its stories', else `Sprint.pointsPlanned`). */
  committed: number;
  /** Points done (its stories', else `Sprint.pointsCompleted`). */
  completed: number;
  /** Whether the numbers come from the sprint's stories (false: typed on the sprint). */
  fromStories: boolean;
  /** Done stories with no points. */
  unestimatedDone: number;
  sayDo: SayDo | null;
}

/**
 * What the review can show for `sprint` from the shared data: the goal and
 * whether it was met, the done stories and the points. A team without
 * pointed stories falls back to the numbers typed on the sprint.
 */
export function reviewFacts(
  sprint: Sprint,
  stories: readonly Story[],
  goals: readonly SprintGoal[] | undefined
): ReviewFacts {
  const doc = (goals ?? []).find((g) => g.id === goalDocId(sprint.id));
  const goal = (doc?.goal ?? "").trim() || (sprint.goal ?? "").trim() || null;
  const raw = doc?.outcome;
  const goalOutcome = raw && GOAL_MET.has(raw.met) ? raw : null;
  const planned = stories.filter((s) => s.sprintId === sprint.id);
  const done = planned.filter((s) => s.status === "done");
  const notDone = planned.filter((s) => s.status !== "done");
  const progress = storyProgress(stories, sprint.id);
  const fromStories = progress.scope > 0;
  const committed = fromStories ? progress.scope : Math.max(0, sprint.pointsPlanned || 0);
  const completed = fromStories ? progress.done : Math.max(0, sprint.pointsCompleted ?? 0);
  return {
    goal,
    goalOutcome,
    done,
    notDone,
    committed,
    completed,
    fromStories,
    unestimatedDone: done.filter((s) => typeof s.points !== "number" || !Number.isFinite(s.points))
      .length,
    sayDo: sayDoRatio(committed, fromStories || sprint.pointsCompleted != null ? completed : null),
  };
}
