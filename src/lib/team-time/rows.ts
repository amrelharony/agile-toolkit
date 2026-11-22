/**
 * Team Time's rows as they are stored: readers that turn a stored or synced
 * row into a usable one (or null), the rules the CRUD refuses a write for,
 * and who counts as the same person. Pure and server-safe: the
 * workspace.team_time_* CRUDs import it, and so does the page. The tool may
 * extend it, keeping these exports.
 */

import {
  TEAM_TIME_ANSWERS,
  TEAM_TIME_MAX,
  TEAM_TIME_POLL_STATUSES,
  TEAM_TIME_ROTATION_MODES,
  TOOL_TEXT_MAX,
  type TeamTimeAnswer,
  type TeamTimeHeld,
  type TeamTimePerson,
  type TeamTimePoll,
  type TeamTimePollAnswer,
  type TeamTimeRotation,
  type TeamTimeRotationOption,
  type TeamTimeSlot,
} from "@/lib/stores/workspace-types";
import { TIME_PATTERN } from "@/lib/sprints/cadence";
import { isIsoDate } from "@/lib/sprints/calendar";
import { nameKey } from "@/lib/team/names";
import { canonicalZone } from "./zones";

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

/** A string cut to `max`, or undefined when it isn't one. */
const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" ? v.slice(0, max) : undefined;

const isTime = (v: unknown): v is string => typeof v === "string" && TIME_PATTERN.test(v);

/** Whether `v` is a YYYY-MM-DD day the calendar has. */
export const isCalendarDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isIsoDate(v);

/** Weekdays (0 Sunday to 6 Saturday), each once, in order. */
function weekdays(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const days = v.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

/** Whether `v` is an ISO instant Date can read. */
const isInstant = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

const stamps = (raw: Row) => ({
  createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
  updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
});

const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * A usable person, or null: no id, a zone Intl doesn't know, a start or end
 * that isn't HH:MM, a start equal to the end, or no working days. Office days
 * that aren't working days are dropped; text is cut to its caps.
 */
export function readPerson(raw: unknown): TeamTimePerson | null {
  if (!isRow(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  const timeZone = typeof raw.timeZone === "string" ? canonicalZone(raw.timeZone) : null;
  if (!timeZone || !isTime(raw.start) || !isTime(raw.end) || raw.start === raw.end) return null;
  const workingDays = weekdays(raw.workingDays);
  if (workingDays.length === 0) return null;
  const officeDays = weekdays(raw.officeDays).filter((d) => workingDays.includes(d));
  const teamMemberId = text(raw.teamMemberId, TOOL_TEXT_MAX.short);
  const site = text(raw.site, TEAM_TIME_MAX.site);
  const note = text(raw.note, TOOL_TEXT_MAX.text);
  return {
    id: raw.id,
    ...(teamMemberId ? { teamMemberId } : {}),
    name: text(raw.name, TOOL_TEXT_MAX.short) ?? "",
    timeZone,
    start: raw.start,
    end: raw.end,
    workingDays,
    ...(officeDays.length > 0 ? { officeDays } : {}),
    ...(site ? { site } : {}),
    ...(note ? { note } : {}),
    ...stamps(raw),
  };
}

/**
 * A usable poll, or null: no id or no length. Slots that aren't an id and an
 * instant are dropped, then capped; each answer keeps only picks for the
 * poll's slots; a chosen slot it doesn't have is dropped.
 */
export function readPoll(raw: unknown): TeamTimePoll | null {
  if (!isRow(raw) || typeof raw.id !== "string" || raw.id === "" || !positive(raw.minutes)) {
    return null;
  }
  const slots: TeamTimeSlot[] = (Array.isArray(raw.slots) ? raw.slots : [])
    .filter((s): s is Row => isRow(s) && typeof s.id === "string" && isInstant(s.start))
    .map((s) => ({ id: s.id as string, start: s.start as string }))
    .slice(0, TEAM_TIME_MAX.slots);
  const slotIds = new Set(slots.map((s) => s.id));
  const answers: TeamTimePollAnswer[] = (Array.isArray(raw.answers) ? raw.answers : [])
    .filter((a): a is Row => isRow(a) && typeof a.name === "string")
    .map((a) => ({
      name: (a.name as string).slice(0, TOOL_TEXT_MAX.short),
      picks: Object.fromEntries(
        Object.entries(isRow(a.picks) ? a.picks : {}).filter(
          (entry): entry is [string, TeamTimeAnswer] =>
            slotIds.has(entry[0]) && (TEAM_TIME_ANSWERS as readonly unknown[]).includes(entry[1])
        )
      ),
    }))
    .slice(0, TEAM_TIME_MAX.answers);
  const status = (TEAM_TIME_POLL_STATUSES as readonly unknown[]).includes(raw.status)
    ? (raw.status as TeamTimePoll["status"])
    : "open";
  const chosenSlotId =
    typeof raw.chosenSlotId === "string" && slotIds.has(raw.chosenSlotId)
      ? raw.chosenSlotId
      : undefined;
  const note = text(raw.note, TOOL_TEXT_MAX.text);
  return {
    id: raw.id,
    title: text(raw.title, TOOL_TEXT_MAX.short) ?? "",
    minutes: raw.minutes,
    slots,
    answers,
    status,
    ...(chosenSlotId ? { chosenSlotId } : {}),
    ...(note ? { note } : {}),
    ...stamps(raw),
  };
}

/**
 * A usable rotation, or null: no id, no length, a start date the calendar
 * doesn't have, or fewer than 2 usable options (an option with a bad time or
 * a zone Intl doesn't know is dropped). Options, attendees and held
 * meetings are cut to their caps; a held meeting of an option that's gone is
 * dropped.
 */
export function readRotation(raw: unknown): TeamTimeRotation | null {
  if (!isRow(raw) || typeof raw.id !== "string" || raw.id === "" || !positive(raw.minutes)) {
    return null;
  }
  if (!isCalendarDay(raw.startDate)) return null;
  const options: TeamTimeRotationOption[] = [];
  for (const o of Array.isArray(raw.options) ? raw.options : []) {
    if (!isRow(o) || typeof o.id !== "string" || !isTime(o.time)) continue;
    if (!Number.isInteger(o.weekday) || (o.weekday as number) < 0 || (o.weekday as number) > 6) {
      continue;
    }
    const timeZone = typeof o.timeZone === "string" ? canonicalZone(o.timeZone) : null;
    if (!timeZone) continue;
    const label = text(o.label, TEAM_TIME_MAX.label);
    options.push({
      id: o.id,
      ...(label ? { label } : {}),
      weekday: o.weekday as number,
      time: o.time,
      timeZone,
    });
  }
  if (options.length < 2) return null;
  const kept = options.slice(0, TEAM_TIME_MAX.options);
  const optionIds = new Set(kept.map((o) => o.id));
  const held: TeamTimeHeld[] = (Array.isArray(raw.held) ? raw.held : [])
    .filter(
      (h): h is Row =>
        isRow(h) &&
        isCalendarDay(h.date) &&
        typeof h.optionId === "string" &&
        optionIds.has(h.optionId)
    )
    .map((h) => ({
      date: h.date as string,
      optionId: h.optionId as string,
      ...(h.skipped === true ? { skipped: true as const } : {}),
    }))
    .slice(-TEAM_TIME_MAX.held);
  const attendees = Array.isArray(raw.attendees)
    ? raw.attendees
        .filter((a): a is string => typeof a === "string")
        .slice(0, TEAM_TIME_MAX.attendees)
    : undefined;
  const everyWeeks = [1, 2, 3, 4].includes(raw.everyWeeks as number)
    ? (raw.everyWeeks as TeamTimeRotation["everyWeeks"])
    : 1;
  const mode = (TEAM_TIME_ROTATION_MODES as readonly unknown[]).includes(raw.mode)
    ? (raw.mode as TeamTimeRotation["mode"])
    : "in-turn";
  const meetingAuditId = text(raw.meetingAuditId, TOOL_TEXT_MAX.short);
  return {
    id: raw.id,
    meeting: text(raw.meeting, TOOL_TEXT_MAX.short) ?? "",
    minutes: raw.minutes,
    everyWeeks,
    startDate: raw.startDate,
    mode,
    options: kept,
    ...(attendees ? { attendees } : {}),
    held,
    ...(meetingAuditId ? { meetingAuditId } : {}),
    ...stamps(raw),
  };
}

/** What's wrong with a person a write would save: a start equal to its end, office days off the working days. */
export function personProblems(next: TeamTimePerson): string[] {
  const problems: string[] = [];
  if (next.start === next.end) {
    problems.push(
      `The working hours start and end at the same time (${next.start}). Set an end that isn't the start.`
    );
  }
  const off = (next.officeDays ?? []).filter((d) => !next.workingDays.includes(d));
  if (off.length > 0) {
    problems.push(
      `Office days ${off.join(", ")} aren't working days. Pick office days among the working days.`
    );
  }
  return problems;
}

/** What's wrong with a poll a write would save: repeated slots, a choice or pick of a slot it doesn't have. */
export function pollProblems(next: TeamTimePoll): string[] {
  const problems: string[] = [];
  const ids = next.slots.map((s) => s.id);
  const repeatedIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (repeatedIds.length > 0) {
    problems.push(
      `Slot ids repeat (${Array.from(new Set(repeatedIds)).join(", ")}). Give each slot its own id.`
    );
  }
  const instants = next.slots.map((s) => Date.parse(s.start));
  const repeatedTimes = next.slots.filter((s, i) => instants.indexOf(instants[i]) !== i);
  if (repeatedTimes.length > 0) {
    problems.push(
      `Slots repeat a time (${repeatedTimes.map((s) => s.start).join(", ")}). Offer each time once.`
    );
  }
  const slotIds = new Set(ids);
  if (next.chosenSlotId !== undefined && !slotIds.has(next.chosenSlotId)) {
    problems.push(`The chosen slot ${next.chosenSlotId} isn't one of the poll's slots.`);
  }
  for (const answer of next.answers) {
    const stray = Object.keys(answer.picks).filter((id) => !slotIds.has(id));
    if (stray.length > 0) {
      problems.push(
        `${answer.name}'s answer picks slots the poll doesn't have (${stray.join(", ")}).`
      );
    }
  }
  return problems;
}

/** What's wrong with a rotation a write would save: fewer than 2 or more than 4 options, a bad start date. */
export function rotationProblems(next: TeamTimeRotation): string[] {
  const problems: string[] = [];
  const n = next.options.length;
  if (n < 2 || n > TEAM_TIME_MAX.options) {
    problems.push(
      `A rotation moves between 2 and ${TEAM_TIME_MAX.options} times; this one has ${n}.`
    );
  }
  if (!isCalendarDay(next.startDate)) {
    problems.push(`The start date ${next.startDate} isn't a day on the calendar (YYYY-MM-DD).`);
  }
  return problems;
}

/**
 * Whether two rows are the same person: the same roster member when both
 * name one, otherwise the same name (trimmed, any case).
 */
export function samePerson(
  a: Pick<TeamTimePerson, "teamMemberId" | "name">,
  b: Pick<TeamTimePerson, "teamMemberId" | "name">
): boolean {
  if (a.teamMemberId && b.teamMemberId) return a.teamMemberId === b.teamMemberId;
  const key = nameKey(a.name);
  return key !== "" && key === nameKey(b.name);
}
