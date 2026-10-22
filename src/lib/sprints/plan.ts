/**
 * Picking stories for a sprint. One implementation for the Sprint Planning
 * page's "Fill to capacity" and the agent's `intent.plan_sprint`, so a plan
 * proposed by either is the same plan.
 */

import type { Story } from "@/lib/stores/workspace-types";

/** Points of a story, 0 when unestimated. */
export function storyPoints(story: Pick<Story, "points">): number {
  return typeof story.points === "number" && Number.isFinite(story.points) ? story.points : 0;
}

/** Sum of the stories' points. */
export function totalStoryPoints(stories: readonly Pick<Story, "points">[]): number {
  return Math.round(stories.reduce((sum, s) => sum + storyPoints(s), 0) * 10) / 10;
}

/** Backlog stories, highest priority score first; unscored ones last, in their stored order. */
export function backlogByPriority(stories: readonly Story[]): Story[] {
  return stories
    .filter((s) => s.status === "backlog")
    .slice()
    .sort((a, b) => (b.priorityScore ?? -Infinity) - (a.priorityScore ?? -Infinity));
}

export interface CapacitySelection {
  selected: Story[];
  totalPoints: number;
  /** Capacity left after the selection. */
  remaining: number;
}

/**
 * Greedy by priority: take each backlog story in priority order while it
 * fits in what's left of `capacityPoints`. Unestimated stories are skipped —
 * they can't be weighed against a capacity.
 */
export function selectStoriesForCapacity(
  stories: readonly Story[],
  capacityPoints: number
): CapacitySelection {
  const selected: Story[] = [];
  let remaining = Number.isFinite(capacityPoints) ? capacityPoints : 0;
  for (const story of backlogByPriority(stories)) {
    const pts = storyPoints(story);
    if (pts <= 0) continue;
    if (pts > remaining) continue;
    selected.push(story);
    remaining -= pts;
  }
  return {
    selected,
    totalPoints: Math.round((capacityPoints - remaining) * 10) / 10,
    remaining: Math.round(remaining * 10) / 10,
  };
}
