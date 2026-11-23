/**
 * Team Time's rows as the page and Amr's verbs change them: reading a
 * stored list, a new or edited person, poll and rotation, an answer, a
 * choice, a held or skipped meeting, who on the roster has a row, and the
 * team's ceremonies on each person's clock. Pure and server-safe: every
 * function takes the time it needs, and none reads the machine's zone.
 */

import {
  CEREMONY_CADENCE_ID,
  TEAM_TIME_MAX,
  type CeremonyCadenceDoc,
  type TeamMember,
  type TeamTimeAnswer,
  type TeamTimeHeld,
  type TeamTimePerson,
  type TeamTimePoll,
  type TeamTimeRotation,
  type TeamTimeRotationOption,
} from "@/lib/stores/workspace-types";
import {
  CEREMONY_LABEL,
  ceremonyTimeboxMinutes,
  normalizeCadence,
  type CeremonyCadence,
  type CeremonyKind,
} from "@/lib/sprints/cadence";
import {
  isoDayNumber,
  isoFromDayNumber,
  normalizeHolidays,
  weekdayOf,
} from "@/lib/sprints/calendar";
import { findRosterMember, nameKey } from "@/lib/team/names";
import { readPerson, readPoll, readRotation, samePerson } from "./rows";
import { MINUTE_MS } from "./overlap";
import { burden, type Burden } from "./slots";
import type { PersonValues, PollValues, RotationValues } from "./validate";
import { canonicalZone, localClock, wallToUtc } from "./zones";

/** The usable rows of a stored list (a bad row written elsewhere is left out). */
export const readPeople = (raw: readonly unknown[] | undefined): TeamTimePerson[] =>
  (raw ?? []).map(readPerson).filter((p): p is TeamTimePerson => p !== null);
export const readPolls = (raw: readonly unknown[] | undefined): TeamTimePoll[] =>
  (raw ?? []).map(readPoll).filter((p): p is TeamTimePoll => p !== null);
export const readRotations = (raw: readonly unknown[] | undefined): TeamTimeRotation[] =>
  (raw ?? []).map(readRotation).filter((r): r is TeamTimeRotation => r !== null);

/* ── People ───────────────────────────────────────────────────────────── */

/** A new person from checked values. */
export function newPerson(values: PersonValues, id: string, now: string): TeamTimePerson {
  return { id, ...values, createdAt: now, updatedAt: now };
}

/** A person with checked values in place of theirs (the id and createdAt kept). */
export function editedPerson(
  prev: TeamTimePerson,
  values: PersonValues,
  now: string
): TeamTimePerson {
  return { id: prev.id, ...values, createdAt: prev.createdAt || now, updatedAt: now };
}

/** A roster member, the Team Time row that is them (if any), or a guest row with no member. */
export interface PersonRow {
  member: TeamMember | null;
  person: TeamTimePerson | null;
}

/**
 * Every roster member with their row (by `teamMemberId`, else by name),
 * in roster order, then the rows that match no member (guests).
 */
export function personRows(
  roster: readonly TeamMember[],
  people: readonly TeamTimePerson[]
): PersonRow[] {
  const used = new Set<string>();
  const rows: PersonRow[] = roster.map((member) => {
    const person =
      people.find((p) => !used.has(p.id) && p.teamMemberId === member.id) ??
      people.find(
        (p) => !used.has(p.id) && !p.teamMemberId && nameKey(p.name) === nameKey(member.name)
      ) ??
      null;
    if (person) used.add(person.id);
    return { member, person };
  });
  for (const p of people) if (!used.has(p.id)) rows.push({ member: null, person: p });
  return rows;
}

/** The roster member a name is, for a row a verb writes: its id, when one matches. */
export function memberIdFor(roster: readonly TeamMember[], name: string): string | undefined {
  return findRosterMember(roster, name)?.id;
}

/** The person already saved as the same person as `who`, if any. */
export function findSamePerson(
  people: readonly TeamTimePerson[],
  who: Pick<TeamTimePerson, "teamMemberId" | "name">
): TeamTimePerson | undefined {
  return people.find((p) => samePerson(p, who));
}

/* ── Polls ────────────────────────────────────────────────────────────── */

/** A new open poll from checked values; `slotId(i)` names each slot. */
export function newPoll(
  values: PollValues,
  id: string,
  slotId: (i: number) => string,
  now: string
): TeamTimePoll {
  return {
    id,
    title: values.title,
    minutes: values.minutes,
    slots: values.starts.map((start, i) => ({ id: slotId(i), start })),
    answers: [],
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

/** The poll with its slots in time order. */
export function sortedSlots(poll: TeamTimePoll): TeamTimePoll["slots"] {
  return [...poll.slots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** The poll with one person's answer to one slot set (or cleared with null). */
export function withAnswer(
  poll: TeamTimePoll,
  name: string,
  slotId: string,
  answer: TeamTimeAnswer | null,
  now: string
): TeamTimePoll {
  const key = nameKey(name);
  const answers = poll.answers.map((a) => ({ name: a.name, picks: { ...a.picks } }));
  let row = answers.find((a) => nameKey(a.name) === key);
  if (!row) {
    if (answer === null || answers.length >= TEAM_TIME_MAX.answers) return poll;
    row = { name: name.trim(), picks: {} };
    answers.push(row);
  }
  if (answer === null) delete row.picks[slotId];
  else row.picks[slotId] = answer;
  return {
    ...poll,
    answers: answers.filter((a) => Object.keys(a.picks).length > 0),
    updatedAt: now,
  };
}

/** The poll closed on `slotId`. */
export function chosenPoll(poll: TeamTimePoll, slotId: string, now: string): TeamTimePoll {
  return { ...poll, status: "closed", chosenSlotId: slotId, updatedAt: now };
}

/** The poll open again, with no slot chosen. */
export function reopenedPoll(poll: TeamTimePoll, now: string): TeamTimePoll {
  const next: TeamTimePoll = { ...poll, status: "open", updatedAt: now };
  delete next.chosenSlotId;
  return next;
}

/** The poll with a slot added (kept in time order). */
export function withSlot(poll: TeamTimePoll, id: string, start: string, now: string): TeamTimePoll {
  return {
    ...poll,
    slots: sortedSlots({ ...poll, slots: [...poll.slots, { id, start }] }),
    updatedAt: now,
  };
}

/** The poll without a slot, and without the picks of it. */
export function withoutSlot(poll: TeamTimePoll, slotId: string, now: string): TeamTimePoll {
  const next: TeamTimePoll = {
    ...poll,
    slots: poll.slots.filter((s) => s.id !== slotId),
    answers: poll.answers
      .map((a) => {
        const picks = { ...a.picks };
        delete picks[slotId];
        return { name: a.name, picks };
      })
      .filter((a) => Object.keys(a.picks).length > 0),
    updatedAt: now,
  };
  if (next.chosenSlotId === slotId) {
    delete next.chosenSlotId;
    next.status = "open";
  }
  return next;
}

/** Whether an open poll has waited this many days for a choice (the next step's nudge). */
export const POLL_WAIT_DAYS = 3;

/* ── Rotations ────────────────────────────────────────────────────────── */

/** What makes a rotation's time the same time: its weekday, its HH:MM and its zone (canonical). */
const optionKey = (o: Pick<TeamTimeRotationOption, "weekday" | "time" | "timeZone">) =>
  `${o.weekday}|${o.time}|${canonicalZone(o.timeZone.trim()) ?? o.timeZone}`;

/**
 * A new or edited rotation from checked values; `optionId(i)` names new
 * options. A time keeps its id (and so its held meetings) only while its
 * weekday, time and zone stay the same, whatever its place in the list or
 * its label; a changed time is a new one. The page and Amr's plan_rotation
 * both come through here, so they keep the same held meetings.
 */
export function rotationFrom(
  values: RotationValues,
  prev: TeamTimeRotation | null,
  id: string,
  optionId: (i: number) => string,
  now: string
): TeamTimeRotation {
  const kept = new Map<string, string>();
  for (const o of prev?.options ?? []) {
    const key = optionKey(o);
    if (!kept.has(key)) kept.set(key, o.id);
  }
  const used = new Set<string>();
  const options = values.options.map((o, i) => {
    const same = kept.get(optionKey(o));
    const optId = same && !used.has(same) ? same : optionId(i);
    used.add(optId);
    return {
      id: optId,
      ...(o.label ? { label: o.label } : {}),
      weekday: o.weekday,
      time: o.time,
      timeZone: o.timeZone,
    };
  });
  const ids = new Set(options.map((o) => o.id));
  const next: TeamTimeRotation = {
    id,
    meeting: values.meeting,
    minutes: values.minutes,
    everyWeeks: values.everyWeeks,
    startDate: values.startDate,
    mode: values.mode,
    options,
    ...(values.attendees && values.attendees.length > 0 ? { attendees: values.attendees } : {}),
    // A held meeting of a time that's gone can't be counted: it goes too.
    held: (prev?.held ?? []).filter((h) => ids.has(h.optionId)),
    ...(prev?.meetingAuditId ? { meetingAuditId: prev.meetingAuditId } : {}),
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  return next;
}

/** The rotation with a meeting marked held (or skipped), the newest 52 kept. */
export function withHeld(
  rotation: TeamTimeRotation,
  held: Pick<TeamTimeHeld, "date" | "optionId">,
  skipped: boolean,
  now: string
): TeamTimeRotation {
  const row: TeamTimeHeld = {
    date: held.date,
    optionId: held.optionId,
    ...(skipped ? { skipped: true as const } : {}),
  };
  const rest = rotation.held.filter((h) => h.date !== held.date || h.optionId !== held.optionId);
  return {
    ...rotation,
    held: [...rest, row].sort((a, b) => a.date.localeCompare(b.date)).slice(-TEAM_TIME_MAX.held),
    updatedAt: now,
  };
}

/* ── The team's ceremonies ────────────────────────────────────────────── */

/** The team's saved cadence, or null when it has saved none (the default isn't the team's). */
export function savedCadence(
  docs: readonly CeremonyCadenceDoc[] | undefined
): CeremonyCadence | null {
  const doc = (docs ?? []).find((d) => d.id === CEREMONY_CADENCE_ID);
  return doc ? normalizeCadence(doc) : null;
}

/** One ceremony's next meeting, on the viewer's clock. */
export interface CeremonyTime {
  kind: CeremonyKind;
  label: string;
  /** "HH:MM" on the viewer's clock (the cadence's own time). */
  time: string;
  /** ISO instant. */
  start: string;
  minutes: number;
}

/** The first day from `fromDay` on (14 days at most) that `ok` accepts. */
function nextDay(fromDay: string, ok: (day: string, weekday: number) => boolean): string | null {
  const start = isoDayNumber(fromDay);
  if (start === null) return null;
  for (let d = start; d < start + 14; d++) {
    const day = isoFromDayNumber(d);
    const weekday = weekdayOf(day);
    if (weekday !== null && ok(day, weekday)) return day;
  }
  return null;
}

/**
 * The cadence's ceremonies as the team meets them next, on the viewer's
 * clock (`zone`): cadence times are the browser's local times, as the
 * calendar file reads them. The Daily Scrum and refinement on their own
 * days; planning, review and retro on the next working day (their real day
 * depends on the sprint). Holidays are skipped.
 */
export function ceremonyTimes(
  cadence: CeremonyCadence,
  now: Date | number,
  zone: string
): CeremonyTime[] {
  const at = typeof now === "number" ? now : now.getTime();
  const today = localClock(zone, at).day;
  const holidays = new Set(normalizeHolidays(cadence.holidays));
  const workingDays = cadence.workingDays ?? [1, 2, 3, 4, 5];
  const out: CeremonyTime[] = [];
  const add = (kind: CeremonyKind, time: string, ok: (weekday: number) => boolean) => {
    const day = nextDay(today, (d, weekday) => {
      if (holidays.has(d) || !ok(weekday)) return false;
      const t = wallToUtc(d, time, zone);
      return t !== null && t.getTime() >= at;
    });
    const start = day ? wallToUtc(day, time, zone) : null;
    if (!start) return;
    out.push({
      kind,
      label: CEREMONY_LABEL[kind],
      time,
      start: start.toISOString(),
      minutes: ceremonyTimeboxMinutes(kind, cadence.sprintLengthDays),
    });
  };
  add("daily", cadence.dailyTime, (w) => cadence.dailyWeekdays.includes(w));
  if (cadence.refinement) {
    const r = cadence.refinement;
    add("refinement", r.time, (w) => w === r.weekday);
  }
  add("planning", cadence.planningTime, (w) => workingDays.includes(w));
  add("review", cadence.reviewTime, (w) => workingDays.includes(w));
  add("retro", cadence.retroTime, (w) => workingDays.includes(w));
  return out;
}

/** Each person's burden for a meeting that starts at `start` (ISO) and lasts `minutes`. */
export function meetingBurdens(
  people: readonly TeamTimePerson[],
  start: string,
  minutes: number
): { personId: string; burden: Burden }[] {
  const at = Date.parse(start);
  if (Number.isNaN(at)) return [];
  return people.map((p) => ({ personId: p.id, burden: burden(p, at, at + minutes * MINUTE_MS) }));
}
