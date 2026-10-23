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
  /** 0–100, whole numbers; 100 only when `done`, so rounding never reads as finished. */
  pct: number;
  /** Every linked story is done, or (typed) the unrounded progress is 100. */
  done: boolean;
  /** For stories: done points over total points, or done stories over stories. */
  basis: "points" | "count" | null;
  count: number;
  doneCount: number;
  points: number;
  donePoints: number;
  /** Linked stories with no estimate. */
  unestimated: number;
}

/** Whether the story has an estimate (0 counts: a spike or chore can be sized at nothing). */
export const isEstimated = (s: Story) => typeof s.points === "number" && Number.isFinite(s.points);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A whole-number percentage that reads 100 only when the work is done:
 * 199 of 200 points rounds to 100, and an open 0-point story leaves the
 * points at 100%, yet the epic isn't finished.
 */
const shownPct = (pct: number, done: boolean) => (done ? 100 : Math.min(99, pct));

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
    const done = Number(epic.progress) >= 100;
    return {
      source: "typed",
      pct: shownPct(typedProgress(epic.progress), done),
      done,
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
    if (!isEstimated(s)) {
      unestimated++;
      continue;
    }
    points += s.points as number;
    if (done) donePoints += s.points as number;
  }
  const byPoints = unestimated === 0 && points > 0;
  const done = doneCount === linked.length;
  const pct = byPoints
    ? (completionPct(donePoints, points) ?? 0)
    : (completionPct(doneCount, linked.length) ?? 0);
  return {
    source: "stories",
    pct: shownPct(pct, done),
    done,
    basis: byPoints ? "points" : "count",
    count: linked.length,
    doneCount,
    points: round1(points),
    donePoints: round1(donePoints),
    unestimated,
  };
}

/**
 * "18 of 30 points done", "2 of 6 stories done", "Typed". When every point
 * is done but 0-point stories are still open, it says so, beside the 99%.
 */
export function rollupLabel(r: EpicRollup): string {
  if (r.source === "typed") return "Typed";
  if (r.basis === "points") {
    const label = `${r.donePoints} of ${r.points} points done`;
    const open = r.count - r.doneCount;
    return !r.done && r.donePoints >= r.points
      ? `${label}, ${open} ${open === 1 ? "story" : "stories"} still open`
      : label;
  }
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
 * Where the epic stands against its quarters today: done once its roll-up
 * says so (`EpicRollup.done`, never a rounded 100%); overdue once its end
 * quarter has passed; "ending" during its last quarter.
 */
export function epicSchedule(
  epic: Pick<Epic, "startQuarter" | "endQuarter">,
  done: boolean,
  now: Date = new Date()
): EpicSchedule {
  if (done) return "done";
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
