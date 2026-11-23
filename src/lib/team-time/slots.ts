/**
 * Meeting times and what they cost each person: a burden for the worst
 * minute of the meeting on the person's own clock (0 in their hours, 1 early
 * or late, 2 at night or on a day off), times ranked by it, a poll's
 * answers filled from it, and a poll's tallies. Pure and server-safe; the
 * page and Amr's verbs rank the same times.
 */

import { isoDayNumber, isoFromDayNumber, weekdayOf } from "@/lib/sprints/calendar";
import {
  TEAM_TIME_MAX,
  type TeamTimeAnswer,
  type TeamTimePerson,
  type TeamTimePoll,
  type TeamTimePollAnswer,
} from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import { slotLabel } from "./format";
import { DAY_MS, MINUTE_MS, localDaysAround, workIntervals, type Interval } from "./overlap";
import { wallToUtc } from "./zones";

/** 0: in their hours. 1: outside them, early or late. 2: at night (22:00–06:59) or on a day off. */
export type Burden = 0 | 1 | 2;

/** The words for each burden. */
export const BURDEN_LABEL: Record<Burden, string> = {
  0: "in hours",
  1: "early or late",
  2: "night or day off",
};

/** Where the night starts and ends on a person's own clock. */
const NIGHT_FROM = "22:00";
const NIGHT_TO = "07:00";

/** A meeting length the page and the verbs take, in minutes. */
export const MEETING_MINUTES = { min: 15, max: 480 } as const;
/** Days ahead "Suggest times" looks. */
export const SUGGEST_DAYS_MAX = 14;
/** Candidate times start on the half hour (UTC). */
export const SLOT_STEP_MINUTES = 30;
/** The most times a ranking returns. */
export const RANKED_SLOTS_MAX = 20;
/**
 * The most slots "Vote on it in Quick Vote" sends: a live choice round takes
 * at most 12 options (`VOTE_LIMITS.maxChoiceOptions`, vote-room/protocol).
 */
export const QUICK_VOTE_SLOTS = 12;

type Hours = Pick<TeamTimePerson, "id" | "timeZone" | "start" | "end" | "workingDays">;

interface Segment extends Interval {
  value: 1 | 2;
}

/** A person's clock over a stretch of time: their working hours and how bad every other minute is. */
export interface Timeline {
  work: Interval[];
  rest: Segment[];
}

/** The person's timeline from `from` to `to` (instants), a day either side included. */
export function personTimeline(person: Hours, from: number, to: number): Timeline {
  const work = workIntervals(person, from - DAY_MS, to + DAY_MS);
  const rest: Segment[] = [];
  for (const day of localDaysAround(person.timeZone, from, to)) {
    const n = isoDayNumber(day);
    const weekday = weekdayOf(day);
    if (n === null || weekday === null) continue;
    const next = isoFromDayNumber(n + 1);
    const m0 = wallToUtc(day, "00:00", person.timeZone)?.getTime();
    const m24 = wallToUtc(next, "00:00", person.timeZone)?.getTime();
    if (m0 === undefined || m24 === undefined) continue;
    if (!person.workingDays.includes(weekday)) {
      rest.push({ start: m0, end: m24, value: 2 });
      continue;
    }
    const m7 = wallToUtc(day, NIGHT_TO, person.timeZone)?.getTime() ?? m0;
    const m22 = wallToUtc(day, NIGHT_FROM, person.timeZone)?.getTime() ?? m24;
    rest.push({ start: m0, end: m7, value: 2 });
    rest.push({ start: m7, end: m22, value: 1 });
    rest.push({ start: m22, end: m24, value: 2 });
  }
  return { work, rest: rest.filter((s) => s.end > s.start) };
}

/** The worst burden in [a, b) outside working hours, from the rest segments. */
function restBurden(t: Timeline, a: number, b: number): Burden {
  let worst: Burden = 0;
  let covered = false;
  for (const s of t.rest) {
    if (s.end <= a || s.start >= b) continue;
    covered = true;
    if (s.value > worst) worst = s.value;
    if (worst === 2) break;
  }
  // A minute no day covers can't happen; count it as outside hours.
  return covered ? worst : 1;
}

/** The burden of a meeting from `start` to `end` on a timeline: its worst minute. */
export function burdenOn(t: Timeline, start: number, end: number): Burden {
  let worst: Burden = 0;
  let cursor = start;
  for (const w of t.work) {
    if (w.end <= cursor) continue;
    if (w.start >= end) break;
    if (w.start > cursor) {
      const b = restBurden(t, cursor, Math.min(w.start, end));
      if (b > worst) worst = b;
    }
    cursor = Math.max(cursor, w.end);
    if (cursor >= end || worst === 2) break;
  }
  if (cursor < end && worst < 2) {
    const b = restBurden(t, cursor, end);
    if (b > worst) worst = b;
  }
  return worst;
}

/** The burden of a meeting from `start` to `end` for one person: its worst minute on their clock. */
export function burden(person: Hours, start: Date | number, end: Date | number): Burden {
  const a = typeof start === "number" ? start : start.getTime();
  const b = typeof end === "number" ? end : end.getTime();
  if (!(b > a)) return 0;
  return burdenOn(personTimeline(person, a, b), a, b);
}

/** A ranked time: its start and each person's burden. */
export interface RankedSlot {
  /** ISO instant. */
  start: string;
  /** By person id. */
  burdens: Record<string, Burden>;
  /** How many have it at night or on a day off. */
  night: number;
  /** How many have it early or late. */
  outside: number;
}

/**
 * Times for a meeting of `minutes`, every half hour from `from` (never
 * before it) for `days` days, ranked by fewest people at night or on a day
 * off, then fewest early or late, then the earliest. At most 20.
 */
export function rankSlots(
  people: readonly Hours[],
  opts: { minutes: number; from: Date | number; days?: number; step?: number; limit?: number }
): RankedSlot[] {
  const minutes = Math.max(1, Math.round(opts.minutes));
  const from = typeof opts.from === "number" ? opts.from : opts.from.getTime();
  const days = Math.min(SUGGEST_DAYS_MAX, Math.max(1, Math.round(opts.days ?? 7)));
  const step = Math.max(5, Math.round(opts.step ?? SLOT_STEP_MINUTES)) * MINUTE_MS;
  const limit = Math.min(RANKED_SLOTS_MAX, Math.max(1, opts.limit ?? RANKED_SLOTS_MAX));
  if (people.length === 0) return [];
  const until = from + days * DAY_MS;
  const length = minutes * MINUTE_MS;
  const timelines = people.map((p) => ({ id: p.id, t: personTimeline(p, from, until + length) }));
  const out: RankedSlot[] = [];
  for (let at = Math.ceil(from / step) * step; at < until; at += step) {
    const burdens: Record<string, Burden> = {};
    let night = 0;
    let outside = 0;
    for (const { id, t } of timelines) {
      const b = burdenOn(t, at, at + length);
      burdens[id] = b;
      if (b === 2) night++;
      else if (b === 1) outside++;
    }
    out.push({ start: new Date(at).toISOString(), burdens, night, outside });
  }
  return out
    .sort((a, b) => a.night - b.night || a.outside - b.outside || a.start.localeCompare(b.start))
    .slice(0, limit);
}

/** The answer hours suggest: in hours yes, early or late "if needed", night or a day off no. */
export const ANSWER_FOR_BURDEN: Record<Burden, TeamTimeAnswer> = { 0: "yes", 1: "maybe", 2: "no" };

/** The words for each answer. */
export const ANSWER_LABEL: Record<TeamTimeAnswer, string> = {
  yes: "Yes",
  maybe: "If needed",
  no: "No",
};

/**
 * Each person's names for matching their poll answers: the name the page
 * shows (`shown`, the roster's name today) first, then the name their row
 * keeps, unless that is someone else's shown name. A rename on the roster
 * so keeps the answers recorded under the old name.
 */
export function answerNames(
  people: readonly Pick<TeamTimePerson, "id" | "name">[],
  shown: (personId: string) => string
): Map<string, string[]> {
  const today = new Map(people.map((p) => [p.id, shown(p.id).trim()]));
  const owner = new Map<string, string>();
  for (const [id, n] of Array.from(today)) if (nameKey(n)) owner.set(nameKey(n), id);
  const out = new Map<string, string[]>();
  for (const p of people) {
    const first = today.get(p.id) ?? "";
    const kept = p.name.trim();
    const key = nameKey(kept);
    const also = key && key !== nameKey(first) && (owner.get(key) ?? p.id) === p.id;
    out.set(
      p.id,
      [first, ...(also ? [kept] : [])].filter((n) => n !== "")
    );
  }
  return out;
}

/** The index of the answer row under the first of `names` that has one (-1 with none). */
export function answerRowIndex(
  answers: readonly Pick<TeamTimePollAnswer, "name">[],
  names: readonly (string | null | undefined)[]
): number {
  for (const n of names) {
    const key = nameKey(n);
    if (!key) continue;
    const at = answers.findIndex((a) => nameKey(a.name) === key);
    if (at >= 0) return at;
  }
  return -1;
}

/**
 * The poll's answers with every person's missing picks filled from their
 * hours. Picks already recorded stay; people are matched by name. `names`
 * gives each person's names (`answerNames`): the first is written, any
 * other finds a row recorded under it, which then takes the first. A poll
 * keeps up to 50 answers, so nobody new is added past that (the CRUD and
 * the row reader hold the same cap).
 */
export function fillFromHours(
  poll: Pick<TeamTimePoll, "slots" | "answers" | "minutes">,
  people: readonly Hours[],
  names: ReadonlyMap<string, string | readonly string[]>
): TeamTimePollAnswer[] {
  const answers = poll.answers.map((a) => ({ name: a.name, picks: { ...a.picks } }));
  const length = poll.minutes * MINUTE_MS;
  for (const p of people) {
    const given = names.get(p.id);
    const all = (typeof given === "string" ? [given] : [...(given ?? [])])
      .map((n) => n.trim())
      .filter((n) => n !== "");
    const name = all[0];
    if (!name) continue;
    const at = answerRowIndex(answers, all);
    let row = at >= 0 ? answers[at] : null;
    if (row && nameKey(row.name) !== nameKey(name)) row.name = name;
    if (!row) {
      if (answers.length >= TEAM_TIME_MAX.answers) continue;
      row = { name, picks: {} };
      answers.push(row);
    }
    for (const s of poll.slots) {
      if (row.picks[s.id]) continue;
      const at = Date.parse(s.start);
      if (Number.isNaN(at)) continue;
      row.picks[s.id] = ANSWER_FOR_BURDEN[burden(p, at, at + length)];
    }
  }
  return answers;
}

/** How many said yes, "if needed" and no to each slot. */
export type Tally = Record<TeamTimeAnswer, number>;

export function tallies(poll: Pick<TeamTimePoll, "slots" | "answers">): Record<string, Tally> {
  const out: Record<string, Tally> = {};
  for (const s of poll.slots) out[s.id] = { yes: 0, maybe: 0, no: 0 };
  for (const a of poll.answers) {
    for (const [slotId, pick] of Object.entries(a.picks)) {
      if (out[slotId] && pick in out[slotId]) out[slotId][pick] += 1;
    }
  }
  return out;
}

/** The slot most can make: most yes, then most "if needed", then the earliest. Null with no answers. */
export function bestSlot(poll: Pick<TeamTimePoll, "slots" | "answers">): string | null {
  const t = tallies(poll);
  const answered = poll.slots.filter((s) => t[s.id].yes + t[s.id].maybe + t[s.id].no > 0);
  if (answered.length === 0) return null;
  const best = [...answered].sort(
    (a, b) =>
      t[b.id].yes - t[a.id].yes ||
      t[b.id].maybe - t[a.id].maybe ||
      Date.parse(a.start) - Date.parse(b.start)
  )[0];
  return best.id;
}

/** The poll's slots as Quick Vote options: the first 12, in UTC so everyone reads the same time. */
export function quickVoteLabels(poll: Pick<TeamTimePoll, "slots">): string[] {
  return poll.slots.slice(0, QUICK_VOTE_SLOTS).map((s) => slotLabel(s.start));
}
