import type {
  DesignSprintDay,
  DesignSprintOutput,
  DesignSprintPlan,
  DesignSprintTask,
  HandoffLink,
} from "@/lib/stores/workspace-types";
import { DESIGN_SPRINT_DAY_NAMES } from "@/lib/design-sprint/plan";
import { DESIGN_SPRINT_ID, findingsOf } from "@/lib/design-sprint/doc";
import { DEFAULT_CALENDAR, isoDayNumber, type WorkingCalendar } from "@/lib/sprints/calendar";
import { designSprintToday, type DesignSprintToday } from "@/lib/design-sprint/day";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";

/**
 * Pure reads and edits of the design sprint document: its days, their
 * tasks and outputs, and the old free-text artifacts read as notes. The
 * page's writes (./use-design-sprint.ts) go through these so an agent's
 * concurrent change to another day or item survives.
 */

/** The document's id (lib/design-sprint/doc, shared with the agent actions). */
export const DS_ID = DESIGN_SPRINT_ID;

// The document's reads and edits are shared with the agent actions.
export {
  dayOutputs,
  legacyNoteId,
  outputsOfKind,
  planDay,
  planDays,
  sprintQuestions,
  findingsOf,
  updateDay,
  withLegacyNotes,
  withOutputPatch,
} from "@/lib/design-sprint/doc";

export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const TASK_TEXT_MAX = 500;
export const PERSON_MAX = 200;

/* ── Tasks ──────────────────────────────────────────────────────────── */

export function dayTasks(day: DesignSprintDay): DesignSprintTask[] {
  return Array.isArray(day.tasks) ? day.tasks : [];
}

export function withTaskPatch(
  day: DesignSprintDay,
  id: string,
  patch: (t: DesignSprintTask) => DesignSprintTask
): DesignSprintDay {
  return { ...day, tasks: dayTasks(day).map((t) => (t.id === id ? patch(t) : t)) };
}

export interface TaskTotals {
  done: number;
  total: number;
}

export function taskTotals(days: readonly DesignSprintDay[]): TaskTotals {
  let done = 0;
  let total = 0;
  for (const d of days) {
    for (const t of dayTasks(d)) {
      total++;
      if (t.done) done++;
    }
  }
  return { done, total };
}

/**
 * Where an output was sent: the links whose target still exists. A
 * hypothesis or story deleted in its own tool no longer counts as sent, so
 * the row, the verdict, the Findings tile and the export agree, and the menu
 * offers to send it again.
 */
export function liveSentTo(o: Pick<DesignSprintOutput, "sentTo">): HandoffLink[] {
  const links = Array.isArray(o.sentTo) ? o.sentTo : [];
  // A route this build doesn't know has no target to look for.
  return links.filter(
    (l) => Boolean(getHandoffRoute(l.route)) && liveLink(links, l.route)?.targetId === l.targetId
  );
}

export interface FindingsSent {
  total: number;
  /** Findings with a link to a hypothesis. */
  hypotheses: number;
  /** Findings with a link to a backlog story. */
  stories: number;
  /** Findings sent anywhere. */
  sent: number;
}

export function findingsSent(plan: Pick<DesignSprintPlan, "days">): FindingsSent {
  const links = findingsOf(plan).map(liveSentTo);
  const on = (route: string) => links.filter((ls) => ls.some((l) => l.route === route)).length;
  return {
    total: links.length,
    hypotheses: on("hypothesis"),
    stories: on("backlog-story"),
    sent: links.filter((ls) => ls.length > 0).length,
  };
}

/* ── Dates ──────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

function utc(iso: string): Date | null {
  const n = isoDayNumber(iso);
  return n === null ? null : new Date(n * DAY_MS);
}

/** "Mon 26 Oct"; "" for a malformed date. Read in UTC so no time zone moves the day. */
export function shortDay(iso: string | undefined): string {
  const d = utc(iso ?? "");
  return d
    ? d.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";
}

/** "Monday 26 Oct". */
export function longDay(iso: string | undefined): string {
  const d = utc(iso ?? "");
  return d
    ? d.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";
}

/** "Mon 19 Oct – Fri 23 Oct 2026", or "" without the five dates. */
export function dateRange(dates: readonly string[]): string {
  if (dates.length === 0) return "";
  const last = dates[dates.length - 1];
  return `${shortDay(dates[0])} – ${shortDay(last)} ${last.slice(0, 4)}`;
}

/**
 * Where the sprint stands on `today` (lib/design-sprint/day, which the agent
 * actions read too). `startsIn` is day 1's place among the working days
 * after today, so 1 is the next working day, weekend or not.
 */
export function sprintToday(
  startDate: string,
  today: string,
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): DesignSprintToday {
  return designSprintToday(startDate, today, calendar);
}

/** Working days of the sprint still ahead, today included when it's one of them. */
export function workingDaysLeft(t: Pick<DesignSprintToday, "dates">, today: string): number {
  return t.dates.filter((d) => d >= today).length;
}

/**
 * Where the sprint stands, in a few words: "Day 3 of 5 · Decide",
 * "Upcoming: starts in 2 working days", "Over", "Completed".
 */
export function statusText(
  plan: Pick<DesignSprintPlan, "completedAt">,
  t: DesignSprintToday
): string {
  if (plan.completedAt) return "Completed";
  if (t.dates.length === 0) return "No valid start date";
  if (t.status === "over") return "Over";
  if (t.status === "running" && t.day) {
    return `Day ${t.day} of 5 · ${DESIGN_SPRINT_DAY_NAMES[t.day]}`;
  }
  return `Upcoming: ${startsInText(t.startsIn)}`;
}

/** "starts in 2 working days"; "starts on the next working day" for 1 (sprintToday's count). */
export function startsInText(startsIn: number | undefined): string {
  if (startsIn === undefined || startsIn <= 1) return "starts on the next working day";
  return `starts in ${startsIn} working days`;
}
