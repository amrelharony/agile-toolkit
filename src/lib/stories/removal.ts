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
 */

import type { Sprint, Story } from "@/lib/stores/workspace-types";

export type StoryRemoval = "delete" | "remove-from-sprint" | "locked";

export function storyRemoval(
  story: Pick<Story, "status" | "sprintId">,
  sprints: readonly Pick<Sprint, "id" | "status">[]
): StoryRemoval {
  if (story.status === "done") return "locked";
  if (!story.sprintId) return "delete";
  const sprint = sprints.find((s) => s.id === story.sprintId);
  // Its sprint is gone: nothing left for the story to be history of.
  if (!sprint || sprint.status === "planned") return "delete";
  return sprint.status === "active" ? "remove-from-sprint" : "locked";
}
