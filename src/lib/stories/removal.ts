/**
 * What a story row's remove control may do, in Sprint Planning and in
 * Refinement. One rule, so both pages offer the same thing for the same
 * story. Pure.
 *
 *   - In the backlog, or in a sprint that hasn't started: the story can be
 *     deleted (with Undo).
 *   - In a sprint that is running: it can only leave the sprint. Burnup and
 *     Sprint Metrics build each past day's scope from the sprint moves kept
 *     on the story (lib/sprints/burn.ts), so deleting it would also erase
 *     it from the days it was in scope; moving it back to the backlog
 *     records that it left.
 *   - Done, or in a sprint that is closed: locked. Finished work and a
 *     closed sprint's numbers stay as they were.
 *   - Out of a running or closed sprint it was part of (removed from it,
 *     sent back to the backlog, carried over into the next one): locked
 *     too. That sprint's charts still read the story's moves for the days
 *     it was in scope, so the delete would rewrite them one step later
 *     (`sprintKeepingStory`).
 */

import { storyItems } from "@/lib/flow";
import type { Sprint, Story } from "@/lib/stores/workspace-types";

export type StoryRemoval = "delete" | "remove-from-sprint" | "locked";

type SprintRef = Pick<Sprint, "id" | "status" | "startDate" | "endDate">;

/** A sprint that has started: its days are on record. */
const started = (sprint: Pick<Sprint, "status">) => sprint.status !== "planned";

/**
 * The running or closed sprint whose record still counts a story that has
 * left it: the latest one it left, when it has several. A sprint counts the
 * story by the rule its board is read with (lib/flow `storyItems`): the
 * story left on or after the sprint's first day. So a story ticked in and
 * out while the sprint was still being planned is not kept for it, and
 * neither is one whose sprint has been deleted.
 *
 * Undefined for a done story and for one in a started sprint now: those are
 * locked, or leave the sprint, by where they are.
 */
export function sprintKeepingStory<S extends SprintRef>(
  story: Story,
  sprints: readonly S[]
): S | undefined {
  if (story.status === "done") return undefined;
  const current = story.sprintId ? sprints.find((s) => s.id === story.sprintId) : undefined;
  if (current && started(current)) return undefined;
  const moves = Array.isArray(story.sprintHistory) ? story.sprintHistory : [];
  const seen = new Set<string>();
  for (let i = moves.length - 1; i >= 0; i--) {
    const from = moves[i]?.from;
    if (!from || seen.has(from)) continue;
    seen.add(from);
    const sprint = sprints.find((s) => s.id === from);
    if (!sprint || !started(sprint)) continue;
    // Example rows count: an example's own sprints keep their stories too.
    if (storyItems([story], { sprint, includeExamples: true }).length > 0) return sprint;
  }
  return undefined;
}

/** Why a story kept for a sprint shows no bin, in the words both pages use. */
export function keptForSprintNote(sprintName: string): string {
  return `Was in ${sprintName}, so it can't be deleted`;
}

export function storyRemoval(story: Story, sprints: readonly SprintRef[]): StoryRemoval {
  if (story.status === "done") return "locked";
  const sprint = story.sprintId ? sprints.find((s) => s.id === story.sprintId) : undefined;
  if (sprint && started(sprint)) {
    return sprint.status === "active" ? "remove-from-sprint" : "locked";
  }
  // In the backlog, in a sprint that hasn't started, or its sprint is gone
  // (nothing left for the story to be history of).
  return sprintKeepingStory(story, sprints) ? "locked" : "delete";
}
