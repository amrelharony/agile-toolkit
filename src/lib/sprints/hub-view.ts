/**
 * What the Sprint Metrics hub and the Sprint Cockpit show for one sprint, as plain text: the
 * header's day line, the tiles, each tool card's status line and the
 * data-quality nudges. Pure, so the page and the Markdown export say the
 * same thing and tests can check the wording without rendering.
 */

import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
// Not from workspace-store: loading the store starts the sync registry.
import { selectCompletedSprints } from "@/lib/stores/sprint-selectors";
import {
  DEFAULT_VELOCITY_WINDOW,
  gapLabel,
  velocity,
  type SprintStatus,
} from "@/lib/sprints/metrics";
import {
  completedAt,
  dayForDate,
  hasSyntheticDates,
  lastLoggedDay,
  sprintLengthDays,
} from "@/lib/sprints/series";

/** How many finished sprints the averages use. */
export const AVERAGE_WINDOW = DEFAULT_VELOCITY_WINDOW;

export const STATUS_LABEL: Record<Sprint["status"], string> = {
  planned: "Planned",
  active: "Active",
  completed: "Done",
  cancelled: "Cancelled",
};

/** A number for display: whole numbers as is, others to one decimal. */
export function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
}

/** "1 point", "3 points", "2.5 points" */
export function points(n: number): string {
  return `${fmt(n)} ${Math.abs(n) === 1 ? "point" : "points"}`;
}

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** Completed sprints with points, oldest first by start date. */
export function completedSprints(sprints: readonly Sprint[]): Sprint[] {
  return selectCompletedSprints({ sprints });
}

export interface AverageVelocity {
  average: number | null;
  /** How many sprints went into it. */
  count: number;
}

/**
 * Mean completed points of the latest finished sprints (latest by end date,
 * the shared `velocity`), leaving out `excludeId`.
 */
export function averageVelocity(completed: readonly Sprint[], excludeId?: string): AverageVelocity {
  const pool = excludeId ? completed.filter((s) => s.id !== excludeId) : completed;
  const { average, count } = velocity(pool, { window: AVERAGE_WINDOW });
  return { average, count };
}

/** "Day 3 of 10", "Starts in 2 days", "Ended 4 days ago", or "No dates set". */
export function sprintDayLine(sprint: Sprint, today: string): string {
  if (hasSyntheticDates(sprint)) return "No dates set";
  const day = dayForDate(sprint, today);
  if (day === null) return "No dates set";
  const length = sprintLengthDays(sprint);
  if (day < 0) return `Starts in ${days(-day)}`;
  if (day > length) return `Ended ${days(day - length)} ago`;
  return `Day ${day} of ${length}`;
}

/** "5 Oct – 15 Oct 2026", or null when the dates can't be placed. */
export function sprintDates(sprint: Sprint): string | null {
  if (hasSyntheticDates(sprint)) return null;
  const parse = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const start = parse(sprint.startDate);
  const end = parse(sprint.endDate);
  if (!start || !end) return null;
  const sameYear = start.getFullYear() === end.getFullYear();
  const a = start.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const b = end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${a} – ${b}`;
}

export type TileId =
  | "committed"
  | "scope"
  | "done"
  | "remaining"
  | "gap"
  | "finish"
  | "average"
  | "rating"
  /** The cockpit's open-impediments tile. */
  | "blockers";

export interface Tile {
  id: TileId;
  label: string;
  value: string;
  /** Shown smaller after the value ("points", "/ 10"). */
  unit?: string;
  hint?: string;
  tone: "default" | "success" | "warning";
  /** No data yet: the value is a message, shown muted. */
  empty?: boolean;
}

const NOT_LOGGED = "Not logged yet";

export interface RatingOption {
  /**
   * The sprint's average score as Sprint Comparison computes it
   * (`averageScore(sprintScores(...))` from lib/sprints/compare), so the
   * tile shows the same number as that page. Null: not scored. Left out,
   * the ratings typed into the sprint's series are averaged, as before.
   */
  rating?: number | null;
}

/** The rating to show: the computed one when given, else the typed ratings' average. */
function ratingOf(status: SprintStatus, opts: RatingOption): number | null {
  return opts.rating !== undefined ? opts.rating : status.averageRating;
}

/**
 * The hub's tiles for one sprint. `average` is the recent velocity of the
 * other finished sprints, for "committed vs average".
 */
export function hubTiles(
  sprint: Sprint,
  status: SprintStatus,
  average: AverageVelocity,
  opts: RatingOption = {}
): Tile[] {
  const logged = status.lastDay !== null;
  const tiles: Tile[] = [
    {
      id: "committed",
      label: "Committed",
      value: fmt(status.committed),
      unit: "points",
      tone: "default",
    },
    {
      id: "scope",
      label: "Scope now",
      value: fmt(status.scopeNow),
      unit: "points",
      hint:
        status.scopeChange > 0
          ? `+${fmt(status.scopeChange)} since the plan`
          : status.scopeChange < 0
            ? `−${fmt(-status.scopeChange)} since the plan`
            : "No change since the plan",
      tone: status.scopeChange > 0 ? "warning" : "default",
    },
  ];

  if (logged && status.done !== null) {
    tiles.push({
      id: "done",
      label: "Done",
      value: fmt(status.done),
      unit: "points",
      hint: status.percentDone !== null ? `${status.percentDone}% of the scope` : undefined,
      tone: "default",
    });
  } else if (sprint.status === "completed" && typeof sprint.pointsCompleted === "number") {
    tiles.push({
      id: "done",
      label: "Done",
      value: fmt(sprint.pointsCompleted),
      unit: "points",
      hint: "When the sprint closed",
      tone: "default",
    });
  } else {
    tiles.push({ id: "done", label: "Done", value: NOT_LOGGED, tone: "default", empty: true });
  }

  if (logged && status.remaining !== null) {
    tiles.push({
      id: "remaining",
      label: "Remaining",
      value: fmt(status.remaining),
      unit: "points",
      hint: `On day ${status.lastDay}`,
      tone: "default",
    });
  } else {
    tiles.push({
      id: "remaining",
      label: "Remaining",
      value: NOT_LOGGED,
      tone: "default",
      empty: true,
    });
  }

  if (logged && status.gap !== null && status.idealRemaining !== null) {
    const gap = status.gap;
    tiles.push({
      id: "gap",
      label: "Pace vs ideal",
      value: gapLabel(gap),
      hint: `Ideal: ${fmt(status.idealRemaining)} left on day ${status.lastDay}`,
      tone: gap > 0 ? "warning" : "success",
    });
  } else {
    tiles.push({
      id: "gap",
      label: "Pace vs ideal",
      value: NOT_LOGGED,
      tone: "default",
      empty: true,
    });
  }

  if (!logged) {
    tiles.push({
      id: "finish",
      label: "Projected finish",
      value: NOT_LOGGED,
      tone: "default",
      empty: true,
    });
  } else if (status.remaining === 0) {
    tiles.push({
      id: "finish",
      label: "Projected finish",
      value: "Finished",
      hint: `All done by day ${status.lastDay}`,
      tone: "success",
    });
  } else if (status.projectedFinishDay === null) {
    tiles.push({
      id: "finish",
      label: "Projected finish",
      value: "No trend yet",
      hint:
        status.loggedDays < 2
          ? "Log another day to see a trend"
          : "The points left aren't going down",
      tone: "default",
      empty: true,
    });
  } else {
    tiles.push({
      id: "finish",
      label: "Projected finish",
      value: `Day ${Math.ceil(status.projectedFinishDay)}`,
      // Say which line: Burnup's "Projected done" projects the done points
      // up to the current scope, so the two can differ after a scope change.
      hint: `Trend of points left · last day is day ${status.lengthDays}`,
      tone: status.willFinishOnTime ? "success" : "warning",
    });
  }

  if (average.average === null) {
    tiles.push({
      id: "average",
      label: "Plan vs average",
      value: "No history yet",
      hint: "Close a sprint to compare",
      tone: "default",
      empty: true,
    });
  } else {
    const diff = Math.round((status.committed - average.average) * 10) / 10;
    const basis =
      average.count === 1 ? "the last sprint" : `the last ${average.count} sprints' average`;
    tiles.push({
      id: "average",
      label: "Plan vs average",
      value: `${fmt(status.committed)} vs ${fmt(average.average)}`,
      hint:
        diff > 0
          ? `${fmt(diff)} over ${basis}`
          : diff < 0
            ? `${fmt(-diff)} under ${basis}`
            : `Same as ${basis}`,
      // More than 10% over what the team has been finishing.
      tone: status.committed > average.average * 1.1 ? "warning" : "default",
    });
  }

  const rating = ratingOf(status, opts);
  if (rating !== null) {
    tiles.push({
      id: "rating",
      label: "Average rating",
      value: fmt(rating),
      unit: "/ 10",
      hint: "From Sprint Comparison",
      tone: "default",
    });
  }
  return tiles;
}

export type SprintToolId =
  | "burndown"
  | "burnup"
  | "velocity"
  | "sprint-compare"
  | "release-planner";

/** One status line per sprint tool card. */
export function toolStatusLines(
  status: SprintStatus,
  teamAverage: AverageVelocity,
  opts: RatingOption = {}
): Record<SprintToolId, string> {
  const logged = status.lastDay !== null && status.done !== null;
  const rating = ratingOf(status, opts);
  return {
    burndown:
      status.loggedDays === 0
        ? NOT_LOGGED
        : `${status.loggedDays} of ${status.lengthDays + 1} days logged`,
    burnup: !logged
      ? NOT_LOGGED
      : `${fmt(status.done as number)} of ${points(status.scopeNow)} done`,
    velocity:
      teamAverage.average === null
        ? "No finished sprints yet"
        : `Average ${points(teamAverage.average)} over ${
            teamAverage.count === 1 ? "1 sprint" : `${teamAverage.count} sprints`
          }`,
    "sprint-compare": rating === null ? "Not rated yet" : `Rated ${fmt(rating)}`,
    "release-planner":
      teamAverage.average === null
        ? "Close a sprint to forecast from velocity"
        : `Ready to forecast from your last ${
            teamAverage.count === 1 ? "sprint" : `${teamAverage.count} sprints`
          }`,
  };
}

/** Completed points to suggest when closing: the daily log's last reading, else what's stored. */
export function suggestedCompletedPoints(
  sprint: Sprint,
  series: SprintSeries | undefined
): { points: number | null; fromDay: number | null } {
  const last = lastLoggedDay(series);
  const logged = last === null ? null : completedAt(sprint, series, last);
  if (logged !== null) return { points: logged, fromDay: last };
  return {
    points: typeof sprint.pointsCompleted === "number" ? sprint.pointsCompleted : null,
    fromDay: null,
  };
}

export type NudgeKind = "no-points" | "synthetic-dates" | "migrated";

/** Where a migrated sprint's data came from, in words: "Burndown and Velocity". */
export function migratedSourceNames(migratedFrom: readonly string[] | undefined): string {
  const names: string[] = [];
  const add = (n: string) => {
    if (!names.includes(n)) names.push(n);
  };
  for (const raw of migratedFrom ?? []) {
    const key = raw.toLowerCase();
    if (key.includes("burndown")) add("Burndown");
    else if (key.includes("burnup")) add("Burnup");
    else if (key.includes("velocity")) add("Velocity");
    else if (key.includes("compare")) add("Sprint Comparison");
  }
  if (names.length === 0) return "older tool data";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Data problems on one sprint, in the order the hub lists them. A migrated
 * sprint the user has already checked (`checked`) isn't flagged again.
 */
export function sprintNudges(
  sprint: Sprint,
  series: SprintSeries | undefined,
  checked: ReadonlySet<string> = new Set()
): NudgeKind[] {
  const out: NudgeKind[] = [];
  if (sprint.status === "completed" && typeof sprint.pointsCompleted !== "number") {
    out.push("no-points");
  }
  if (hasSyntheticDates(sprint)) out.push("synthetic-dates");
  if ((series?.migratedFrom?.length ?? 0) > 0 && !checked.has(sprint.id)) out.push("migrated");
  return out;
}
