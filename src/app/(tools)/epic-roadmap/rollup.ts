import type { Epic, Story } from "@/lib/stores/workspace-types";
import { completionPct } from "@/lib/sprints/metrics";
import { currentQuarterIndex, quarterIndex } from "./quarters";

export const STORY_STATUS_LABEL: Record<Story["status"], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

/** Where an epic's progress comes from. */
export interface EpicRollup {
  /** "stories" when any story is linked; "typed" falls back to `Epic.progress`. */
  source: "stories" | "typed";
  /** 0–100, whole numbers. */
  pct: number;
  /** For stories: done points over total points, or done stories over stories. */
  basis: "points" | "count" | null;
  count: number;
  doneCount: number;
  points: number;
  donePoints: number;
  /** Linked stories with no estimate. */
  unestimated: number;
}

const estimated = (s: Story) => typeof s.points === "number" && Number.isFinite(s.points);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The stories linked to the epic (`Story.epicId`), in stored order. */
export function linkedStories(epicId: string, stories: readonly Story[]): Story[] {
  return stories.filter((s) => s.epicId === epicId);
}

/** A typed progress, as stored data may hold it: clamped to 0–100, 0 when unreadable. */
export function typedProgress(progress: unknown): number {
  const n = Number(progress);
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : 0;
}

/**
 * An epic's progress, rolled up from its linked stories.
 *
 * Typed percentages drifted from the work: an epic read 80% with half its
 * stories untouched. With stories linked, progress is done points over
 * total points — or, while any linked story is unestimated, done stories
 * over stories, so one small finished story can't make a big unestimated
 * epic read 100%. With no stories linked, the typed progress stays.
 */
export function epicRollup(epic: Pick<Epic, "progress">, linked: readonly Story[]): EpicRollup {
  if (linked.length === 0) {
    return {
      source: "typed",
      pct: typedProgress(epic.progress),
      basis: null,
      count: 0,
      doneCount: 0,
      points: 0,
      donePoints: 0,
      unestimated: 0,
    };
  }
  let points = 0;
  let donePoints = 0;
  let doneCount = 0;
  let unestimated = 0;
  for (const s of linked) {
    const done = s.status === "done";
    if (done) doneCount++;
    if (!estimated(s)) {
      unestimated++;
      continue;
    }
    points += s.points as number;
    if (done) donePoints += s.points as number;
  }
  const byPoints = unestimated === 0 && points > 0;
  return {
    source: "stories",
    pct: byPoints
      ? (completionPct(donePoints, points) ?? 0)
      : (completionPct(doneCount, linked.length) ?? 0),
    basis: byPoints ? "points" : "count",
    count: linked.length,
    doneCount,
    points: round1(points),
    donePoints: round1(donePoints),
    unestimated,
  };
}

/** "18 of 30 points done", "2 of 6 stories done", "Typed". */
export function rollupLabel(r: EpicRollup): string {
  if (r.source === "typed") return "Typed";
  if (r.basis === "points") return `${r.donePoints} of ${r.points} points done`;
  return `${r.doneCount} of ${r.count} ${r.count === 1 ? "story" : "stories"} done`;
}

export type EpicSchedule =
  | "unscheduled"
  | "upcoming"
  | "in-progress"
  | "ending"
  | "overdue"
  | "done";

/**
 * Where the epic stands against its quarters today: done at 100%; overdue
 * once its end quarter has passed; "ending" during its last quarter.
 */
export function epicSchedule(
  epic: Pick<Epic, "startQuarter" | "endQuarter">,
  pct: number,
  now: Date = new Date()
): EpicSchedule {
  if (pct >= 100) return "done";
  const start = quarterIndex(epic.startQuarter);
  const end = quarterIndex(epic.endQuarter);
  if (start === 0 || end === 0 || end < start) return "unscheduled";
  const q = currentQuarterIndex(now);
  if (q > end) return "overdue";
  if (q === end) return "ending";
  if (q < start) return "upcoming";
  return "in-progress";
}

export const SCHEDULE_LABEL: Record<EpicSchedule, string> = {
  unscheduled: "No valid quarters",
  upcoming: "Upcoming",
  "in-progress": "Under way",
  ending: "Ends this quarter",
  overdue: "Past its end quarter",
  done: "Done",
};
