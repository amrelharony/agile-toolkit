/**
 * Picking stories for a sprint. One implementation for the Sprint Planning
 * page's "Fill to capacity" and the agent's `intent.plan_sprint`, so a plan
 * proposed by either is the same plan.
 */

import type { BacklogItem, Story } from "@/lib/stores/workspace-types";

/** Where a story pulled from the backlog came from (its sourceRef.tool). */
export const BACKLOG_SOURCE_TOOL = "prioritizer";

/**
 * A backlog item's decided rank (BacklogItem.rank, set by the Prioritizer's
 * Decide order: 1 first), or undefined while it is "Not ordered yet".
 */
export function backlogItemRank(item: Pick<BacklogItem, "rank">): number | undefined {
  const r = item.rank;
  return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : undefined;
}

/**
 * The stories with the decided rank their backlog item holds now. A story
 * keeps the rank it was pulled in with (Story.backlogRank), but every
 * Decide order renumbers the items, so stories pulled under different
 * orders would compare ranks from different orders. A story pulled from
 * an item still in `backlogItems` reads that item's rank instead (none once
 * it is "Not ordered yet"); a story whose item is gone, or that wasn't
 * pulled from the backlog, keeps what it holds. Only the stories whose rank
 * changes are copied; the stored stories are never touched.
 */
export function withLiveBacklogRank(
  stories: readonly Story[],
  backlogItems: readonly Pick<BacklogItem, "id" | "rank">[] | undefined
): Story[] {
  if (!backlogItems || backlogItems.length === 0) return stories.slice();
  const items = new Map(backlogItems.map((b) => [b.id, b]));
  return stories.map((s) => {
    const item = s.sourceRef?.tool === BACKLOG_SOURCE_TOOL ? items.get(s.sourceRef.id) : undefined;
    if (!item) return s;
    const live = backlogItemRank(item);
    if (live === s.backlogRank) return s;
    const next: Story = { ...s };
    if (live === undefined) delete next.backlogRank;
    else next.backlogRank = live;
    return next;
  });
}

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
 * agent's plan and Refinement: the backlog's decided order first
 * (`backlogRank`, 1 first, read live through `withLiveBacklogRank`; a story
 * without one comes after every ranked one), then the priority score,
 * highest first (unscored last). Returns 0 for a tie, so a stable sort
 * keeps the stored order.
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
