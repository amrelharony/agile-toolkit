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

const finiteOr = (n: number | undefined, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? n : fallback;

/**
 * The one backlog order, shared by Sprint Planning, "Fill to capacity", the
 * agent's plan and Refinement: the decided order a story was pulled in with
 * first (`backlogRank`, 1 first; a story without one comes after every
 * ranked one), then the priority score, highest first (unscored last).
 * Returns 0 for a tie, so a stable sort keeps the stored order.
 */
export function compareBacklogOrder(
  a: Pick<Story, "backlogRank" | "priorityScore">,
  b: Pick<Story, "backlogRank" | "priorityScore">
): number {
  const ra = finiteOr(a.backlogRank, Infinity);
  const rb = finiteOr(b.backlogRank, Infinity);
  if (ra !== rb) return ra < rb ? -1 : 1;
  const pa = finiteOr(a.priorityScore, -Infinity);
  const pb = finiteOr(b.priorityScore, -Infinity);
  if (pa !== pb) return pa > pb ? -1 : 1;
  return 0;
}

/** A story pulled with its backlog item's decided rank (Story.backlogRank). */
export const isRankedStory = (s: Pick<Story, "backlogRank">): s is { backlogRank: number } =>
  typeof s.backlogRank === "number" && Number.isFinite(s.backlogRank);

/**
 * How the backlog is ordered, for a heading or a toast: the decided order
 * when any story carries one (compareBacklogOrder puts ranked stories
 * first), else the priority score.
 */
export function backlogOrderText(stories: readonly Pick<Story, "backlogRank">[]): string {
  return stories.some(isRankedStory)
    ? "in the backlog's decided order, then by priority"
    : "highest priority first";
}

/** Backlog stories in the backlog order (compareBacklogOrder); ties keep their stored order. */
export function backlogByPriority(stories: readonly Story[]): Story[] {
  return stories
    .filter((s) => s.status === "backlog")
    .slice()
    .sort(compareBacklogOrder);
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
