/**
 * A sprint's progress read from its stories: the sprint board is the source,
 * and the typed daily log (`SprintSeries`) is the fallback for a team that
 * doesn't keep pointed stories. Pure, so the cockpit, the delivery charts
 * and agents read the same numbers.
 */

import type { Sprint, SprintSeries, Story, StoryStatus } from "@/lib/stores/workspace-types";
import { storyPoints } from "./plan";
import { dayForDate, remainingAt, sortedDays, todayIso } from "./series";
import { STORY_STATUSES } from "./story-status";

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface StatusTally {
  count: number;
  points: number;
}

export interface StoryProgress {
  /** Stories planned into the sprint. */
  count: number;
  /** Their points (an unestimated story counts 0). */
  scope: number;
  /** Points of the done stories. */
  done: number;
  /** Scope minus done. */
  remaining: number;
  doneCount: number;
  /** Stories with no points yet. */
  unestimated: number;
  /** Open stories flagged as blocked. */
  blocked: number;
  byStatus: Record<StoryStatus, StatusTally>;
}

function emptyTallies(): Record<StoryStatus, StatusTally> {
  return Object.fromEntries(STORY_STATUSES.map((s) => [s, { count: 0, points: 0 }])) as Record<
    StoryStatus,
    StatusTally
  >;
}

/** Scope, done and remaining points of the stories planned into `sprintId`, and counts by status. */
export function storyProgress(stories: readonly Story[], sprintId: string): StoryProgress {
  const byStatus = emptyTallies();
  let count = 0;
  let unestimated = 0;
  let blocked = 0;
  for (const story of stories) {
    if (story.sprintId !== sprintId) continue;
    count++;
    const pts = storyPoints(story);
    if (typeof story.points !== "number" || !Number.isFinite(story.points)) unestimated++;
    if (story.blocked && story.status !== "done") blocked++;
    // A status from a newer build or a hand edit still counts towards scope.
    const tally = byStatus[story.status] ?? (byStatus[story.status] = { count: 0, points: 0 });
    tally.count++;
    tally.points += pts;
  }
  for (const tally of Object.values(byStatus)) tally.points = round1(tally.points);
  const scope = round1(Object.values(byStatus).reduce((sum, t) => sum + t.points, 0));
  const done = byStatus.done.points;
  return {
    count,
    scope,
    done,
    remaining: round1(scope - done),
    doneCount: byStatus.done.count,
    unestimated,
    blocked,
    byStatus,
  };
}

export interface CarryOver {
  /** The sprint's stories that aren't done, in stored order. */
  stories: Story[];
  points: number;
}

/** What a sprint leaves unfinished: what carries over to the next sprint or back to the backlog. */
export function carryOver(sprint: Pick<Sprint, "id">, stories: readonly Story[]): CarryOver {
  const open = stories.filter((s) => s.sprintId === sprint.id && s.status !== "done");
  return {
    stories: open,
    points: round1(open.reduce((sum, s) => sum + storyPoints(s), 0)),
  };
}

export interface RemainingToday {
  /** Points left, or null when neither the stories nor the log say. */
  remaining: number | null;
  /** The sprint's pointed stories, the typed daily log, or nothing yet. */
  source: "stories" | "log" | "none";
  /** The logged day the number was read from (source "log"). */
  day?: number;
}

export interface RemainingTodayInput {
  sprint: Pick<Sprint, "id" | "startDate" | "pointsPlanned">;
  stories: readonly Story[];
  series: SprintSeries | undefined;
  /** YYYY-MM-DD, local. Defaults to today. */
  today?: string;
}

/**
 * Points left today. From the stories when the sprint has pointed ones
 * (done ones count as burnt); otherwise the latest reading in the daily log
 * on or before today (any reading when the sprint has no dates).
 */
export function remainingToday({
  sprint,
  stories,
  series,
  today = todayIso(),
}: RemainingTodayInput): RemainingToday {
  const progress = storyProgress(stories, sprint.id);
  if (progress.scope > 0) return { remaining: progress.remaining, source: "stories" };
  const limit = dayForDate(sprint, today) ?? Number.POSITIVE_INFINITY;
  const days = sortedDays(series);
  for (let i = days.length - 1; i >= 0; i--) {
    const { day } = days[i];
    if (day > limit) continue;
    const r = remainingAt(sprint, series, day);
    if (r !== null) return { remaining: r, source: "log", day };
  }
  return { remaining: null, source: "none" };
}
