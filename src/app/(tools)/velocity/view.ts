/**
 * Velocity reads the shared sprints (`workspace.sprints`) directly. This file
 * turns them into the rows the table, chart, Markdown and AI prompts use,
 * and holds the rules for what an edit writes back.
 *
 *   row name  ↔ Sprint.name
 *   committed ↔ Sprint.pointsPlanned
 *   completed ↔ Sprint.pointsCompleted (blank = not entered)
 *   goal      ↔ Sprint.goal
 *
 * A sprint counts toward velocity once it is finished: status "completed"
 * with completed points, the same rule as `selectCompletedSprints` and the
 * `tool.velocity.compute` MCP action.
 */

import type { Sprint } from "@/lib/stores/workspace-types";
import {
  DEFAULT_SPRINT_DAYS,
  endDateFor,
  hasSyntheticDates,
  sprintLengthDays,
  sprintsNewestFirst,
  todayIso,
} from "@/lib/sprints/series";

export interface VelocityRow {
  id: string;
  name: string;
  /** The sprint goal. */
  description?: string;
  committed: number;
  /** Completed points, or null when none are entered yet. */
  completed: number | null;
  status: Sprint["status"];
  /** Counts toward velocity: done, with completed points. */
  finished: boolean;
}

export type FinishedRow = VelocityRow & { completed: number };

export function isFinishedSprint(s: Pick<Sprint, "status" | "pointsCompleted">): boolean {
  return (
    s.status === "completed" &&
    typeof s.pointsCompleted === "number" &&
    Number.isFinite(s.pointsCompleted)
  );
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** The YYYY-MM-DD part of a date, or null. */
function isoDay(value: string | undefined): string | null {
  const m = ISO_DAY.exec(value ?? "");
  return m ? m[0] : null;
}

const byName = (a: Sprint, b: Sprint) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/**
 * Sprints oldest first: the mirror of `sprintsNewestFirst` (undated ones
 * first), except that sprints starting the same day stay in name order.
 */
export function sprintsOldestFirst(sprints: readonly Sprint[]): Sprint[] {
  return [...sprints].sort((a, b) => {
    const da = isoDay(a.startDate);
    const db = isoDay(b.startDate);
    if (da !== db) {
      if (da === null) return -1;
      if (db === null) return 1;
      return da < db ? -1 : 1;
    }
    return byName(a, b);
  });
}

/** Shared sprints as velocity rows, oldest first (chart and table order). */
export function toVelocityRows(sprints: readonly Sprint[]): VelocityRow[] {
  return sprintsOldestFirst(sprints).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.goal?.trim() ? s.goal : undefined,
    committed: Number.isFinite(s.pointsPlanned) ? s.pointsPlanned : 0,
    completed:
      typeof s.pointsCompleted === "number" && Number.isFinite(s.pointsCompleted)
        ? s.pointsCompleted
        : null,
    status: s.status,
    finished: isFinishedSprint(s),
  }));
}

/** The finished rows, in the same order (CUSUM and the trend index into this list). */
export function finishedRows(rows: readonly VelocityRow[]): FinishedRow[] {
  return rows.filter((r): r is FinishedRow => r.finished && r.completed !== null);
}

/**
 * How often the team met its commitment, over finished sprints. A sprint
 * with nothing committed and nothing done says nothing either way, so it is
 * left out (as `tool.velocity.compute`'s commitmentReliability does).
 */
export function commitmentAccuracy(rows: readonly VelocityRow[]): {
  met: number;
  considered: number;
  pct: number;
} {
  const considered = finishedRows(rows).filter((r) => r.committed > 0 || r.completed > 0);
  const met = considered.filter((r) => r.completed >= r.committed).length;
  return {
    met,
    considered: considered.length,
    pct: considered.length > 0 ? (met / considered.length) * 100 : 0,
  };
}

/**
 * What typing `value` into a sprint's completed points writes. Points above
 * zero close a planned or active sprint whose end date has passed (or that
 * has no end date); one still running stays open. Clearing the points keeps
 * the status as it is.
 */
export function completedPointsPatch(
  sprint: Pick<Sprint, "status" | "endDate">,
  value: number | null,
  today: string = todayIso()
): Partial<Pick<Sprint, "pointsCompleted" | "status">> {
  if (value === null) return { pointsCompleted: undefined };
  const open = sprint.status === "planned" || sprint.status === "active";
  const end = isoDay(sprint.endDate);
  const ended = end === null || end < today;
  return value > 0 && open && ended
    ? { pointsCompleted: value, status: "completed" }
    : { pointsCompleted: value };
}

/**
 * Suggested dates for the next sprint: the day after the latest dated
 * sprint ends, with its length; today and the default length when no
 * sprint has real dates.
 */
export function nextSprintDates(
  sprints: readonly Sprint[],
  today: string = todayIso()
): { start: string; lengthDays: number } {
  const latest = sprintsNewestFirst(sprints).find(
    (s) => s.status !== "cancelled" && !hasSyntheticDates(s)
  );
  if (!latest) return { start: today, lengthDays: DEFAULT_SPRINT_DAYS };
  const start = endDateFor(latest.endDate.slice(0, 10), 1);
  return { start: start || today, lengthDays: sprintLengthDays(latest) };
}

const STATUS_LABEL: Record<Sprint["status"], string> = {
  planned: "Planned",
  active: "Active",
  completed: "Done",
  cancelled: "Cancelled",
};

export function statusLabel(status: Sprint["status"]): string {
  return STATUS_LABEL[status] ?? status;
}

/** "5 Oct – 19 Oct", or null when the sprint has no real dates. */
export function sprintDates(sprint: Pick<Sprint, "startDate" | "endDate">): string | null {
  if (hasSyntheticDates(sprint)) return null;
  const fmt = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  return `${fmt(sprint.startDate)} – ${fmt(sprint.endDate)}`;
}
