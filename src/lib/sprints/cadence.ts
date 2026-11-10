/**
 * The team's ceremony cadence: when the Daily Scrum, Planning, Refinement,
 * Review and Retro happen relative to a sprint's dates. Pure helpers; the
 * stored value and its hook live in ./use-ceremony-cadence.ts.
 *
 * Times are local "HH:MM". Days are the sprint's own day numbers (day 0 is
 * the first day, see ./series.ts), so one cadence applies to every sprint.
 *
 * The cadence also holds the team's working week and holidays (optional;
 * Monday to Friday and none until set), which the sprint maths count with
 * (`cadenceCalendar`, ./calendar.ts).
 */

import type { Sprint } from "@/lib/stores/workspace-types";
import { dayDate, hasSyntheticDates, sprintLengthDays } from "./series";
import {
  normalizeCalendar,
  normalizeHolidays,
  normalizeWorkingDays,
  type WorkingCalendar,
} from "./calendar";

export type CeremonyKind = "planning" | "daily" | "refinement" | "review" | "retro";

export const CEREMONY_KINDS: readonly CeremonyKind[] = [
  "planning",
  "daily",
  "refinement",
  "review",
  "retro",
];

export const CEREMONY_LABEL: Record<CeremonyKind, string> = {
  planning: "Sprint Planning",
  daily: "Daily Scrum",
  refinement: "Backlog Refinement",
  review: "Sprint Review",
  retro: "Sprint Retrospective",
};

/** Where each ceremony is run in the toolkit. */
export const CEREMONY_HREF: Record<CeremonyKind, string> = {
  planning: "/sprint-planning",
  daily: "/standup",
  refinement: "/refinement",
  review: "/sprint-review",
  retro: "/retro",
};

/**
 * Timeboxes in minutes for a sprint of four weeks or more: the Scrum
 * Guide's (planning 8 h, review 4 h, retro 3 h, a 15-minute Daily Scrum),
 * and an hour for a refinement session, which the guide doesn't timebox.
 */
const TIMEBOX_FOUR_WEEKS: Record<CeremonyKind, number> = {
  planning: 480,
  daily: 15,
  refinement: 60,
  review: 240,
  retro: 180,
};

/**
 * How long `kind` should take in a sprint of `sprintLengthDays` calendar
 * days. Planning, review and retro shrink with shorter sprints (a two-week
 * sprint: 4 h, 2 h, 1 h 30), rounded to 15 minutes with 15 the least; the
 * Daily Scrum and refinement stay as they are.
 */
export function ceremonyTimeboxMinutes(kind: CeremonyKind, sprintLengthDays: number): number {
  const full = TIMEBOX_FOUR_WEEKS[kind];
  if (kind === "daily" || kind === "refinement") return full;
  const days = Number.isFinite(sprintLengthDays) && sprintLengthDays > 0 ? sprintLengthDays : 14;
  const scaled = full * Math.min(1, days / 28);
  return Math.max(15, Math.round(scaled / 15) * 15);
}

/** A timebox in words: "15 min", "2 h", "1 h 30". */
export function timeboxLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

export interface CeremonyCadence {
  /** Calendar days from the first day to the last day (a two-week sprint is 14). */
  sprintLengthDays: number;
  /** Local "HH:MM". */
  dailyTime: string;
  /** Weekdays the Daily Scrum runs on: 0 = Sunday … 6 = Saturday. */
  dailyWeekdays: number[];
  /** Planning is on day 0. */
  planningTime: string;
  /** Review and retro are on the last day. */
  reviewTime: string;
  retroTime: string;
  /** Weekly refinement, or null when the team folds it into other sessions. */
  refinement: { weekday: number; time: string } | null;
  /** Weekdays the team works (0 = Sunday … 6 = Saturday). Absent: Monday to Friday. */
  workingDays?: number[];
  /** Team holidays, "YYYY-MM-DD": no work, no Daily Scrum, no refinement. */
  holidays?: string[];
}

export const DEFAULT_CADENCE: CeremonyCadence = {
  sprintLengthDays: 14,
  dailyTime: "09:30",
  dailyWeekdays: [1, 2, 3, 4, 5],
  planningTime: "10:00",
  reviewTime: "14:00",
  retroTime: "15:30",
  refinement: { weekday: 3, time: "11:00" },
};

export const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** A local time as "HH:MM", 24-hour. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A sprint is at least one and at most this many calendar days long. */
export const MAX_SPRINT_LENGTH_DAYS = 60;

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

function isWeekday(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
}

/** A usable cadence from whatever was stored (older shapes, hand edits). */
export function normalizeCadence(raw: unknown): CeremonyCadence {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<
    Record<keyof CeremonyCadence, unknown>
  >;
  const length = Number(r.sprintLengthDays);
  const weekdays = Array.isArray(r.dailyWeekdays)
    ? Array.from(new Set(r.dailyWeekdays.filter(isWeekday))).sort((a, b) => a - b)
    : DEFAULT_CADENCE.dailyWeekdays;
  const ref = r.refinement as { weekday?: unknown; time?: unknown } | null | undefined;
  return {
    sprintLengthDays:
      Number.isInteger(length) && length >= 1 && length <= MAX_SPRINT_LENGTH_DAYS
        ? length
        : DEFAULT_CADENCE.sprintLengthDays,
    dailyTime: isTime(r.dailyTime) ? r.dailyTime : DEFAULT_CADENCE.dailyTime,
    dailyWeekdays: weekdays.length > 0 ? weekdays : DEFAULT_CADENCE.dailyWeekdays,
    planningTime: isTime(r.planningTime) ? r.planningTime : DEFAULT_CADENCE.planningTime,
    reviewTime: isTime(r.reviewTime) ? r.reviewTime : DEFAULT_CADENCE.reviewTime,
    retroTime: isTime(r.retroTime) ? r.retroTime : DEFAULT_CADENCE.retroTime,
    refinement:
      ref === null
        ? null
        : ref && isWeekday(ref.weekday)
          ? { weekday: ref.weekday, time: isTime(ref.time) ? ref.time : "11:00" }
          : DEFAULT_CADENCE.refinement,
    // Kept only when set, so a cadence without them reads (and saves) as before.
    ...optionalCalendarFields(r.workingDays, r.holidays),
  };
}

function optionalCalendarFields(
  workingDays: unknown,
  holidays: unknown
): Pick<CeremonyCadence, "workingDays" | "holidays"> {
  const days = normalizeWorkingDays(workingDays);
  const off = normalizeHolidays(holidays);
  return { ...(days ? { workingDays: days } : {}), ...(off.length > 0 ? { holidays: off } : {}) };
}

/** The team's working calendar from its cadence (the default week when unset). */
export function cadenceCalendar(
  cadence: Pick<CeremonyCadence, "workingDays" | "holidays"> | null | undefined
): WorkingCalendar {
  return normalizeCalendar(cadence);
}

export interface CeremonyOccurrence {
  kind: CeremonyKind;
  /** Local date and time. */
  at: Date;
  /** The sprint day it falls on. */
  day: number;
}

/** A local Date for `YYYY-MM-DD` at `HH:MM`, or null when either is malformed. */
export function localDateTime(iso: string, time: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const t = TIME_PATTERN.exec(time);
  if (!m || !t) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), 0, 0);
}

/** Every ceremony of a sprint, in time order. Empty when the sprint has no real dates. */
export function ceremonyDates(sprint: Sprint, cadence: CeremonyCadence): CeremonyOccurrence[] {
  if (hasSyntheticDates(sprint)) return [];
  const length = sprintLengthDays(sprint);
  const out: CeremonyOccurrence[] = [];
  const push = (kind: CeremonyKind, day: number, time: string) => {
    const date = dayDate(sprint, day);
    const at = date ? localDateTime(date, time) : null;
    if (at) out.push({ kind, at, day });
  };
  push("planning", 0, cadence.planningTime);
  const holidays = new Set(normalizeHolidays(cadence.holidays));
  for (let day = 1; day <= length; day++) {
    const date = dayDate(sprint, day);
    const weekday = date ? localDateTime(date, "00:00")?.getDay() : undefined;
    if (weekday === undefined || (date && holidays.has(date))) continue;
    if (cadence.dailyWeekdays.includes(weekday)) push("daily", day, cadence.dailyTime);
    if (cadence.refinement && day < length && weekday === cadence.refinement.weekday) {
      push("refinement", day, cadence.refinement.time);
    }
  }
  push("review", length, cadence.reviewTime);
  push("retro", length, cadence.retroTime);
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The next `limit` ceremonies from `now` on. Empty once the sprint is over. */
export function nextCeremonies(
  sprint: Sprint,
  cadence: CeremonyCadence,
  now: Date,
  limit = 2
): CeremonyOccurrence[] {
  return ceremonyDates(sprint, cadence)
    .filter((o) => o.at.getTime() >= now.getTime())
    .slice(0, limit);
}

/** "Today 09:30", "Tomorrow 14:00", or "Fri 31 Oct 14:00". */
export function whenLabel(at: Date, now: Date): string {
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(at) - startOf(now)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  const date = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${date} ${time}`;
}
