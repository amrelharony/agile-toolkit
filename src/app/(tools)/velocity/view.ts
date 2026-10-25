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
 * with completed points, the rule `velocity()` (lib/sprints/metrics) and the
 * `tool.velocity.compute` MCP action share. Rows are in the order velocity
 * uses, oldest first by end date, so the table, the chart, the export and
 * the agent all read the same "last 3".
 */

import type { CapacityPlan, Sprint } from "@/lib/stores/workspace-types";
import {
  DEFAULT_VELOCITY_WINDOW,
  predictability,
  rollingVelocity,
  sayDoRatio,
  sprintsByEndDate,
  velocity,
  type Predictability,
  type SayDo,
  type Velocity,
} from "@/lib/sprints/metrics";
import { velocityPerPersonDay, type VelocityPerPersonDay } from "@/lib/sprints/capacity";
import {
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
  /** The graded say/do of a finished sprint; null otherwise or without a commitment. */
  sayDo: SayDo | null;
  /** Completed points per available person-day, from the sprint's own capacity plan. */
  perDay: number | null;
  /** The person-days that plan gave the team. */
  personDays: number | null;
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

/**
 * Shared sprints as velocity rows, oldest first by end date (velocity's
 * order; undated sprints first). `plans` adds the points per person-day of
 * the finished sprints that had their own capacity plan.
 */
export function toVelocityRows(
  sprints: readonly Sprint[],
  plans?: readonly CapacityPlan[],
  { includeExamples = false }: { includeExamples?: boolean } = {}
): VelocityRow[] {
  const perDay = new Map(
    velocityPerPersonDay(sprints, plans, {
      window: Number.POSITIVE_INFINITY,
      includeExamples,
    }).perSprint.map((p) => [p.sprintId, p])
  );
  return sprintsByEndDate(sprints).map((s) => {
    const finished = isFinishedSprint(s);
    const committed = Number.isFinite(s.pointsPlanned) ? s.pointsPlanned : 0;
    const completed =
      typeof s.pointsCompleted === "number" && Number.isFinite(s.pointsCompleted)
        ? s.pointsCompleted
        : null;
    const pd = perDay.get(s.id);
    return {
      id: s.id,
      name: s.name,
      description: s.goal?.trim() ? s.goal : undefined,
      committed,
      completed,
      status: s.status,
      finished,
      sayDo: finished ? sayDoRatio(committed, completed) : null,
      perDay: pd?.perDay ?? null,
      personDays: pd?.personDays ?? null,
    };
  });
}

/** The finished rows, in the same order (CUSUM and the trend index into this list). */
export function finishedRows(rows: readonly VelocityRow[]): FinishedRow[] {
  return rows.filter((r): r is FinishedRow => r.finished && r.completed !== null);
}

/** Everything the tiles, the verdict and the export say, from the shared definitions. */
export interface VelocitySummary {
  /** velocity(sprints, {window: 3}): the last 3 finished sprints by end date. */
  velocity: Velocity;
  /** The graded say/do of the latest pointed sprints (window 6). */
  sayDo: Predictability;
  /** Points per available person-day over velocity's window. */
  perPersonDay: VelocityPerPersonDay;
  /** The velocity after each finished sprint, for the rolling-average line. */
  rolling: Map<string, number>;
}

export function velocitySummary(
  sprints: readonly Sprint[],
  plans?: readonly CapacityPlan[],
  { includeExamples = false }: { includeExamples?: boolean } = {}
): VelocitySummary {
  return {
    velocity: velocity(sprints, { window: DEFAULT_VELOCITY_WINDOW }),
    sayDo: predictability(sprints),
    perPersonDay: velocityPerPersonDay(sprints, plans, {
      window: DEFAULT_VELOCITY_WINDOW,
      includeExamples,
    }),
    rolling: new Map(rollingVelocity(sprints).map((r) => [r.sprintId, r.average])),
  };
}

/**
 * What typing `value` into a sprint's completed points writes: the points
 * and nothing else. Closing a sprint is its own step (the close dialog,
 * which asks where the unfinished stories go), never a side effect of
 * typing a number.
 */
export function completedPointsPatch(
  value: number | null
): Partial<Pick<Sprint, "pointsCompleted">> {
  return { pointsCompleted: value === null ? undefined : value };
}

/**
 * Whether an open sprint is past its end: its end date has gone by, or it
 * has no end date and completed points were typed (the old tool's undated
 * rows). Velocity then offers to close it.
 */
export function shouldOfferClose(
  sprint: Pick<Sprint, "status" | "endDate" | "pointsCompleted">,
  today: string = todayIso()
): boolean {
  if (sprint.status !== "planned" && sprint.status !== "active") return false;
  const end = isoDay(sprint.endDate);
  if (end === null) return typeof sprint.pointsCompleted === "number";
  return end < today;
}

/**
 * Suggested dates for the next sprint: the day after the latest dated
 * sprint ends, with its length; today and the team's cadence length when no
 * sprint has real dates.
 */
export function nextSprintDates(
  sprints: readonly Sprint[],
  cadenceLengthDays: number,
  today: string = todayIso()
): { start: string; lengthDays: number } {
  const latest = sprintsNewestFirst(sprints).find(
    (s) => s.status !== "cancelled" && !hasSyntheticDates(s)
  );
  if (!latest) return { start: today, lengthDays: cadenceLengthDays };
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

/** "1.23" points per person-day, to two decimals without trailing zeros. */
export function perDayText(n: number): string {
  return String(Math.round(n * 100) / 100);
}
