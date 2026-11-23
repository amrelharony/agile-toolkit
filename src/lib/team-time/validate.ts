/**
 * What the page's forms and Amr's verbs check before Team Time saves
 * anything: a person, a poll and a rotation, each with plain messages by
 * field. Stricter than the CRUD (lib/team-time/rows): meetings of 15 to 480
 * minutes, at least one slot, "in the future" for the slots being added.
 * Pure and server-safe.
 */

import { isIsoDate } from "@/lib/sprints/calendar";
import {
  TEAM_TIME_MAX,
  TEAM_TIME_ROTATION_MODES,
  TOOL_TEXT_MAX,
  type TeamTimePerson,
  type TeamTimeRotation,
  type TeamTimeRotationMode,
} from "@/lib/stores/workspace-types";
import type { FormErrors, Validation } from "@/lib/utils/form";
import { minuteOf } from "./format";
import { samePerson } from "./rows";
import { MEETING_MINUTES } from "./slots";
import { canonicalZone } from "./zones";

/* ── People ───────────────────────────────────────────────────────────── */

/** A person as the form holds it. */
export interface PersonDraft {
  name: string;
  teamMemberId?: string;
  timeZone: string;
  start: string;
  end: string;
  workingDays: readonly number[];
  officeDays: readonly number[];
  site: string;
  note: string;
}

export type PersonField =
  | "name"
  | "timeZone"
  | "start"
  | "end"
  | "workingDays"
  | "officeDays"
  | "site"
  | "note";

/** A person's checked values: what a row stores, without its id and stamps. */
export type PersonValues = Omit<TeamTimePerson, "id" | "createdAt" | "updatedAt">;

const weekdaysOf = (days: readonly number[]) =>
  Array.from(new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort(
    (a, b) => a - b
  );

/**
 * A person, checked: a name, a zone Intl knows (stored canonical), HH:MM
 * hours that don't start and end at the same time, at least one working
 * day, office days among them, the text caps, and one row per person
 * (`others` are the rows already saved, this one left out).
 */
export function validatePerson(
  draft: PersonDraft,
  others: readonly Pick<TeamTimePerson, "id" | "teamMemberId" | "name">[] = []
): Validation<PersonValues, PersonField> {
  const errors: FormErrors<PersonField> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Enter the person's name.";
  else if (name.length > TOOL_TEXT_MAX.short) {
    errors.name = `Keep the name to ${TOOL_TEXT_MAX.short} characters.`;
  }
  const zone = draft.timeZone.trim();
  const timeZone = zone && zone.length <= TEAM_TIME_MAX.zone ? canonicalZone(zone) : null;
  if (!zone) errors.timeZone = "Pick their time zone.";
  else if (!timeZone)
    errors.timeZone = `"${zone.slice(0, 40)}" isn't a time zone. Pick one from the list.`;
  const start = minuteOf(draft.start);
  const end = minuteOf(draft.end);
  if (start === null) errors.start = "Enter when their day starts, as HH:MM.";
  if (end === null) errors.end = "Enter when their day ends, as HH:MM.";
  else if (start !== null && start === end) {
    errors.end =
      "The day can't end when it starts. A shift past midnight ends earlier than it starts.";
  }
  const workingDays = weekdaysOf(draft.workingDays);
  if (workingDays.length === 0) errors.workingDays = "Pick at least one working day.";
  const officeDays = weekdaysOf(draft.officeDays);
  if (officeDays.some((d) => !workingDays.includes(d))) {
    errors.officeDays = "Office days have to be working days.";
  }
  const site = draft.site.trim();
  if (site.length > TEAM_TIME_MAX.site) {
    errors.site = `Keep the office to ${TEAM_TIME_MAX.site} characters.`;
  }
  const note = draft.note.trim();
  if (note.length > TOOL_TEXT_MAX.text) {
    errors.note = `Keep the note to ${TOOL_TEXT_MAX.text} characters.`;
  }
  if (name && !errors.name) {
    const twin = others.find((o) =>
      samePerson(o, { name, ...(draft.teamMemberId ? { teamMemberId: draft.teamMemberId } : {}) })
    );
    if (twin) errors.name = `${twin.name} already has a row. Edit that one instead.`;
    else if (others.length >= TEAM_TIME_MAX.people) {
      errors.name = `Team Time keeps up to ${TEAM_TIME_MAX.people} people. Remove someone first.`;
    }
  }
  if (Object.keys(errors).length > 0 || !timeZone) return { ok: false, errors };
  return {
    ok: true,
    values: {
      ...(draft.teamMemberId ? { teamMemberId: draft.teamMemberId } : {}),
      name,
      timeZone,
      start: draft.start,
      end: draft.end,
      workingDays,
      ...(officeDays.length > 0 ? { officeDays } : {}),
      ...(site ? { site } : {}),
      ...(note ? { note } : {}),
    },
  };
}

/* ── Polls ────────────────────────────────────────────────────────────── */

export interface PollDraft {
  title: string;
  minutes: number | string;
  /** The slots' starts, ISO instants. */
  starts: readonly string[];
}

export type PollField = "title" | "minutes" | "slots";

export interface PollValues {
  title: string;
  minutes: number;
  /** Sorted, each once, as ISO instants. */
  starts: string[];
}

/** A meeting length typed or given: a whole number of minutes, 15 to 480. */
export function checkMinutes(raw: number | string): number | string {
  const n = typeof raw === "number" ? raw : raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < MEETING_MINUTES.min || n > MEETING_MINUTES.max) {
    return `A meeting is ${MEETING_MINUTES.min} to ${MEETING_MINUTES.max} minutes, in whole minutes.`;
  }
  return n;
}

/**
 * A poll, checked: a title, 15 to 480 minutes and 1 to 20 different
 * times. `added` are the starts being added now (all of them for a new
 * poll): only those must be in the future, so a poll whose times have
 * passed can still be answered, chosen or edited.
 */
export function validatePoll(
  draft: PollDraft,
  opts: { now: Date | number; added?: readonly string[] }
): Validation<PollValues, PollField> {
  const errors: FormErrors<PollField> = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Give the poll a title, such as the meeting's name.";
  else if (title.length > TOOL_TEXT_MAX.short) {
    errors.title = `Keep the title to ${TOOL_TEXT_MAX.short} characters.`;
  }
  const minutes = checkMinutes(draft.minutes);
  if (typeof minutes === "string") errors.minutes = minutes;
  const now = typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const times = draft.starts.map((s) => Date.parse(s));
  const added = new Set((opts.added ?? []).map((s) => Date.parse(s)));
  if (times.some((t) => Number.isNaN(t))) errors.slots = "A time isn't a date and time.";
  else if (times.length === 0) errors.slots = "Add at least one time.";
  else if (new Set(times).size !== times.length) errors.slots = "A time is there twice.";
  else if (times.length > TEAM_TIME_MAX.slots) {
    errors.slots = `A poll offers up to ${TEAM_TIME_MAX.slots} times.`;
  } else if (times.some((t) => added.has(t) && t <= now)) {
    errors.slots = "A new time has to be in the future.";
  }
  if (Object.keys(errors).length > 0 || typeof minutes === "string") return { ok: false, errors };
  return {
    ok: true,
    values: {
      title,
      minutes,
      starts: [...times].sort((a, b) => a - b).map((t) => new Date(t).toISOString()),
    },
  };
}

/* ── Rotations ────────────────────────────────────────────────────────── */

export interface RotationOptionDraft {
  id?: string;
  label: string;
  weekday: number;
  time: string;
  timeZone: string;
}

export interface RotationDraft {
  meeting: string;
  minutes: number | string;
  everyWeeks: number;
  startDate: string;
  mode: string;
  options: readonly RotationOptionDraft[];
  attendees?: readonly string[];
}

export type RotationField =
  | "meeting"
  | "minutes"
  | "everyWeeks"
  | "startDate"
  | "mode"
  | "options"
  | "attendees";

export interface RotationValues {
  meeting: string;
  minutes: number;
  everyWeeks: TeamTimeRotation["everyWeeks"];
  startDate: string;
  mode: TeamTimeRotationMode;
  /** Labels trimmed (blank: none), zones canonical. */
  options: RotationOptionDraft[];
  attendees?: string[];
}

/**
 * A rotation, checked: a meeting, 15 to 480 minutes, every 1 to 4 weeks, a
 * real start date, 2 to 4 different times each with a zone Intl knows
 * (stored canonical), and at most 50 attendees.
 */
export function validateRotation(draft: RotationDraft): Validation<RotationValues, RotationField> {
  const errors: FormErrors<RotationField> = {};
  const meeting = draft.meeting.trim();
  if (!meeting) errors.meeting = "Name the meeting that rotates.";
  else if (meeting.length > TOOL_TEXT_MAX.short) {
    errors.meeting = `Keep the name to ${TOOL_TEXT_MAX.short} characters.`;
  }
  const minutes = checkMinutes(draft.minutes);
  if (typeof minutes === "string") errors.minutes = minutes;
  const everyWeeks = draft.everyWeeks;
  if (![1, 2, 3, 4].includes(everyWeeks)) errors.everyWeeks = "It meets every 1 to 4 weeks.";
  const startDate = draft.startDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !isIsoDate(startDate)) {
    errors.startDate = "Pick the date of the first meeting's week.";
  }
  const mode = (TEAM_TIME_ROTATION_MODES as readonly string[]).includes(draft.mode)
    ? (draft.mode as TeamTimeRotationMode)
    : null;
  if (!mode) errors.mode = "Pick In turn or Fairest.";
  const options: RotationOptionDraft[] = [];
  let optionError: string | null = null;
  draft.options.forEach((o, i) => {
    const zone = canonicalZone(o.timeZone.trim());
    const label = o.label.trim();
    if (!Number.isInteger(o.weekday) || o.weekday < 0 || o.weekday > 6) {
      optionError ??= `Time ${i + 1}: pick its weekday.`;
    } else if (minuteOf(o.time) === null) {
      optionError ??= `Time ${i + 1}: enter its time as HH:MM.`;
    } else if (!zone) {
      optionError ??= `Time ${i + 1}: pick its time zone.`;
    } else if (label.length > TEAM_TIME_MAX.label) {
      optionError ??= `Time ${i + 1}: keep its label to ${TEAM_TIME_MAX.label} characters.`;
    } else {
      options.push({
        ...(o.id ? { id: o.id } : {}),
        label,
        weekday: o.weekday,
        time: o.time,
        timeZone: zone,
      });
    }
  });
  const keys = options.map((o) => `${o.weekday}|${o.time}|${o.timeZone}`);
  if (optionError) errors.options = optionError;
  else if (draft.options.length < 2 || draft.options.length > TEAM_TIME_MAX.options) {
    errors.options = `A rotation moves between 2 and ${TEAM_TIME_MAX.options} times.`;
  } else if (new Set(keys).size !== keys.length) {
    errors.options = "Two of the times are the same. Make each one different.";
  }
  const attendees = draft.attendees ? Array.from(new Set(draft.attendees)) : undefined;
  if (attendees && attendees.length > TEAM_TIME_MAX.attendees) {
    errors.attendees = `A rotation counts up to ${TEAM_TIME_MAX.attendees} people.`;
  }
  if (Object.keys(errors).length > 0 || typeof minutes === "string" || !mode) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    values: {
      meeting,
      minutes,
      everyWeeks: everyWeeks as TeamTimeRotation["everyWeeks"],
      startDate,
      mode,
      options,
      ...(attendees && attendees.length > 0 ? { attendees } : {}),
    },
  };
}
