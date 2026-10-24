import type {
  DesignSprintDay,
  DesignSprintDayNumber,
  DesignSprintOutput,
  DesignSprintPlan,
  DesignSprintTask,
  HandoffLink,
} from "@/lib/stores/workspace-types";
import { DESIGN_SPRINT_DAY_NAMES, DESIGN_SPRINT_DAY_NUMBERS } from "@/lib/design-sprint/plan";
import {
  DEFAULT_CALENDAR,
  isWorkingDay,
  isoDayNumber,
  type WorkingCalendar,
} from "@/lib/sprints/calendar";
import { designSprintToday, type DesignSprintToday } from "@/lib/design-sprint/day";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { isWebLink } from "./outputs";

/**
 * Pure reads and edits of the design sprint document: its days, their
 * tasks and outputs, and the old free-text artifacts read as notes. The
 * page's writes (./use-design-sprint.ts) go through these so an agent's
 * concurrent change to another day or item survives.
 */

/** MUST match DS_ID in src/lib/actions/tools/design-sprint.ts. */
export const DS_ID = "designSprint:current";

export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const TASK_TEXT_MAX = 500;
export const PERSON_MAX = 200;

/* ── Old free-text artifacts ────────────────────────────────────────── */

/** djb2 over the text, base 36: short, and the same on every device. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * The id an old artifact gets as a note. It depends only on the day, the
 * position and the text, so every read and every device gives the same id,
 * and moving the artifacts into outputs twice can't make a duplicate.
 */
export function legacyNoteId(day: number, index: number, text: string): string {
  return `note-${day}-${index}-${hash(text)}`;
}

/**
 * A day's outputs, its old artifacts first as notes (they're older). The
 * artifacts had no ids and were removed by position, so a concurrent edit
 * could delete the wrong one; read here, each gets its stable id. An
 * artifact that is only a link becomes a note with that link.
 */
export function dayOutputs(day: DesignSprintDay): DesignSprintOutput[] {
  const outputs = Array.isArray(day.outputs) ? day.outputs : [];
  const artifacts = Array.isArray(day.artifacts) ? day.artifacts : [];
  if (artifacts.length === 0) return outputs;
  const ids = new Set(outputs.map((o) => o.id));
  const notes: DesignSprintOutput[] = [];
  artifacts.forEach((raw, i) => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return;
    const id = legacyNoteId(day.day, i, text);
    if (ids.has(id)) return;
    notes.push({ id, kind: "note", text, ...(isWebLink(text) ? { url: text } : {}) });
  });
  return [...notes, ...outputs];
}

/** The day with its old artifacts moved into `outputs`, ids kept. A no-op once moved. */
export function withLegacyNotes(day: DesignSprintDay): DesignSprintDay {
  if (!Array.isArray(day.artifacts) || day.artifacts.length === 0) return day;
  return { ...day, artifacts: [], outputs: dayOutputs(day) };
}

/* ── Days ───────────────────────────────────────────────────────────── */

function emptyDay(day: DesignSprintDayNumber): DesignSprintDay {
  return { day, dayName: DESIGN_SPRINT_DAY_NAMES[day], tasks: [], artifacts: [], outputs: [] };
}

/** The five days in order, a missing one filled in empty (for reading). */
export function planDays(plan: Pick<DesignSprintPlan, "days">): DesignSprintDay[] {
  const days = Array.isArray(plan.days) ? plan.days : [];
  return DESIGN_SPRINT_DAY_NUMBERS.map((n) => days.find((d) => d.day === n) ?? emptyDay(n));
}

export function planDay(
  plan: Pick<DesignSprintPlan, "days">,
  day: DesignSprintDayNumber
): DesignSprintDay {
  return planDays(plan).find((d) => d.day === day) ?? emptyDay(day);
}

/**
 * The plan with one day changed by `fn`. The day's old artifacts move into
 * outputs first, so the first edit of a day converts it. A day the stored
 * plan lacks is added.
 */
export function updateDay(
  plan: DesignSprintPlan,
  day: DesignSprintDayNumber,
  fn: (d: DesignSprintDay) => DesignSprintDay
): DesignSprintPlan {
  const days = Array.isArray(plan.days) ? plan.days : [];
  if (!days.some((d) => d.day === day)) {
    const next = [...days, fn(emptyDay(day))].sort((a, b) => a.day - b.day);
    return { ...plan, days: next };
  }
  return {
    ...plan,
    days: days.map((d) => (d.day === day ? fn(withLegacyNotes(d)) : d)),
  };
}

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

/* ── Outputs ────────────────────────────────────────────────────────── */

export function withOutputPatch(
  day: DesignSprintDay,
  id: string,
  patch: (o: DesignSprintOutput) => DesignSprintOutput
): DesignSprintDay {
  return { ...day, outputs: dayOutputs(day).map((o) => (o.id === id ? patch(o) : o)) };
}

/** Every output of `kind`, across the days (findings live on Test day). */
export function outputsOfKind(
  plan: Pick<DesignSprintPlan, "days">,
  kind: DesignSprintOutput["kind"]
): DesignSprintOutput[] {
  return planDays(plan).flatMap((d) => dayOutputs(d).filter((o) => o.kind === kind));
}

/** The Map day's sprint questions, which Test day answers. */
export function sprintQuestions(plan: Pick<DesignSprintPlan, "days">): DesignSprintOutput[] {
  return dayOutputs(planDay(plan, 1)).filter((o) => o.kind === "sprint-question");
}

export function findingsOf(plan: Pick<DesignSprintPlan, "days">): DesignSprintOutput[] {
  return outputsOfKind(plan, "finding");
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
 * Where the sprint stands on `today`, with `startsIn` as the copy reads it:
 * day 1's place among the working days after today, so 1 is the next
 * working day. designSprintToday counts the working days in [today, start),
 * the same number on a working day but one short on a weekend or a holiday:
 * on a Saturday, a Tuesday start would read as "the next working day" when
 * Monday is.
 */
export function sprintToday(
  startDate: string,
  today: string,
  calendar: WorkingCalendar = DEFAULT_CALENDAR
): DesignSprintToday {
  const t = designSprintToday(startDate, today, calendar);
  if (t.startsIn === undefined || isWorkingDay(today, calendar)) return t;
  return { ...t, startsIn: t.startsIn + 1 };
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
