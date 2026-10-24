/**
 * Which day of a design sprint it is, worked out from its start date and
 * the team's working days instead of a number someone has to keep moving
 * on. Shared by the Design Sprint page, its agent actions and the next
 * steps.
 *
 * Day 1 (Map) is the first working day on or after the start date; days 2
 * to 5 are the next working days, so a sprint started on a Thursday runs
 * Thursday, Friday, Monday, Tuesday, Wednesday, and a team holiday moves
 * the rest of the week along.
 */

import type { DesignSprintDayNumber, DesignSprintPlan } from "@/lib/stores/workspace-types";
import {
  DEFAULT_CALENDAR,
  isoDayNumber,
  isoFromDayNumber,
  isWorkingDay,
  workingDaysBetween,
  type WorkingCalendar,
} from "@/lib/sprints/calendar";

export const DESIGN_SPRINT_LENGTH = 5;

export type DesignSprintStatus = "upcoming" | "running" | "over";

export interface DesignSprintToday {
  status: DesignSprintStatus;
  /** Today's day while running (on a day off in the middle: the last day worked); else null. */
  day: DesignSprintDayNumber | null;
  /** While upcoming: day 1's place among the working days after today (1: the next one). */
  startsIn?: number;
  /** The five dates, day 1 first ("YYYY-MM-DD"); empty without a valid start date. */
  dates: string[];
}

/** The five working dates of a sprint starting on `startDate`. */
export function designSprintDates(
  startDate: string,
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): string[] {
  const first = isoDayNumber(startDate);
  if (first === null) return [];
  const out: string[] = [];
  // A calendar with no working day at all would never fill the week.
  for (let n = first, guard = 0; out.length < DESIGN_SPRINT_LENGTH && guard < 3660; n++, guard++) {
    const iso = isoFromDayNumber(n);
    if (isWorkingDay(iso, calendar)) out.push(iso);
  }
  return out.length === DESIGN_SPRINT_LENGTH ? out : [];
}

/** Where a sprint starting on `startDate` stands on `today`. */
export function designSprintToday(
  startDate: string,
  today: string,
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): DesignSprintToday {
  const dates = designSprintDates(startDate, calendar);
  if (dates.length === 0 || isoDayNumber(today) === null) {
    return { status: "upcoming", day: null, dates };
  }
  if (today < dates[0]) {
    // Day 1's place among the working days after today: 1 is the next
    // working day, whether today is one or a weekend.
    const between = workingDaysBetween(today, dates[0], calendar) ?? 0;
    return {
      status: "upcoming",
      day: null,
      startsIn: between + (isWorkingDay(today, calendar) ? 0 : 1),
      dates,
    };
  }
  if (today > dates[DESIGN_SPRINT_LENGTH - 1]) return { status: "over", day: null, dates };
  let index = 0;
  for (let i = 0; i < dates.length; i++) if (dates[i] <= today) index = i;
  return { status: "running", day: (index + 1) as DesignSprintDayNumber, dates };
}

/** The day to show: today's while running, day 1 before it starts, day 5 once it's over. */
export function shownDesignSprintDay(
  t: Pick<DesignSprintToday, "status" | "day">
): DesignSprintDayNumber {
  if (t.status === "running" && t.day) return t.day;
  return t.status === "over" ? 5 : 1;
}

/**
 * The plan with `currentDay` at the day shown on `today`. The day is derived
 * from the start date, but older readers still read `currentDay`, so every
 * write (the page's and the agent actions') keeps it in step.
 */
export function withShownDesignSprintDay(
  plan: DesignSprintPlan,
  today: string,
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): DesignSprintPlan {
  const currentDay = shownDesignSprintDay(designSprintToday(plan.startDate, today, calendar));
  return plan.currentDay === currentDay ? plan : { ...plan, currentDay };
}
