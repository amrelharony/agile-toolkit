/**
 * A meeting that rotates between times, so the same people don't always
 * take the late call. Pure and server-safe; the page and Amr's verbs plan
 * the same occurrences.
 *
 * - Cycle k starts on `startDate + 7 × everyWeeks × k` days. Its meeting is
 *   on the first day on or after that with the option's weekday, at the
 *   option's time on the option's clock (`wallToUtc` on the real date).
 * - A held or skipped row belongs to the cycle its date falls in, and that
 *   cycle is done. A past cycle nobody marked counts as held on the time
 *   the plan gave it: it uses its turn and its points count, so the
 *   rotation goes on when nobody presses Mark held, and a copied schedule
 *   stays right. Only Skip keeps the turn. Points count back 52 cycles (as
 *   many as the held list keeps); an older cycle nobody marked only uses
 *   its turn.
 * - A meeting that started less than a day ago still shows, so it can be
 *   marked held or skipped.
 * - "In turn" goes round the options, from the one after the last held.
 *   "Fairest" picks the option of each cycle that keeps the highest running
 *   total (held plus planned) lowest, the in-turn order breaking ties.
 * - A skipped meeting counts nothing and uses no turn: the next takes the
 *   same option. A team holiday (on the option's clock) is skipped the same
 *   way, as the ceremony dates skip it.
 */

import { isoDayNumber, isoFromDayNumber, weekdayOf } from "@/lib/sprints/calendar";
import {
  TEAM_TIME_MAX,
  type TeamTimeHeld,
  type TeamTimePerson,
  type TeamTimeRotation,
  type TeamTimeRotationOption,
} from "@/lib/stores/workspace-types";
import { DAY_MS, MINUTE_MS } from "./overlap";
import { burden, type Burden } from "./slots";
import { wallToUtc } from "./zones";

/** How many meetings ahead the page and the verbs plan. */
export const ROTATION_PLAN_COUNT = 8;
/** A meeting that started less than this ago still shows, to be marked. */
export const MARK_GRACE_MS = DAY_MS;
/** How far ahead the plan looks before it gives up (holidays, a far start date). */
const MAX_CYCLES = 520;
/** How many cycles back a meeting nobody marked still counts its points (as many as the held list keeps). */
const PRESUMED_CYCLES = TEAM_TIME_MAX.held;

type Person = Pick<TeamTimePerson, "id" | "timeZone" | "start" | "end" | "workingDays">;

/** One planned (or held) meeting of a rotation. */
export interface Occurrence {
  cycle: number;
  /** Its day on the option's clock, "YYYY-MM-DD". */
  date: string;
  optionId: string;
  /** ISO instants. */
  start: string;
  end: string;
  /** Each attendee's burden, by person id. */
  burdens: Record<string, Burden>;
}

/** The people a rotation counts: its attendees, or everyone when it names none. */
export function rotationAttendees<P extends { id: string }>(
  rotation: Pick<TeamTimeRotation, "attendees">,
  people: readonly P[]
): P[] {
  const ids = rotation.attendees;
  if (!ids || ids.length === 0) return [...people];
  const set = new Set(ids);
  return people.filter((p) => set.has(p.id));
}

const cycleDays = (r: Pick<TeamTimeRotation, "everyWeeks">) => 7 * r.everyWeeks;

/** The cycle a day falls in (negative before the start date), or null for a day that isn't one. */
export function cycleOf(
  rotation: Pick<TeamTimeRotation, "startDate" | "everyWeeks">,
  day: string
): number | null {
  const start = isoDayNumber(rotation.startDate);
  const d = isoDayNumber(day);
  if (start === null || d === null) return null;
  return Math.floor((d - start) / cycleDays(rotation));
}

/** When cycle `k`'s meeting is on `option`: its day and its instants. */
export function occurrenceAt(
  rotation: Pick<TeamTimeRotation, "startDate" | "everyWeeks" | "minutes">,
  cycle: number,
  option: TeamTimeRotationOption
): { date: string; start: number; end: number } | null {
  const start = isoDayNumber(rotation.startDate);
  if (start === null) return null;
  const cycleStart = start + cycle * cycleDays(rotation);
  const weekday = weekdayOf(isoFromDayNumber(cycleStart));
  if (weekday === null) return null;
  const date = isoFromDayNumber(cycleStart + ((option.weekday - weekday + 7) % 7));
  const at = wallToUtc(date, option.time, option.timeZone);
  if (!at) return null;
  return { date, start: at.getTime(), end: at.getTime() + rotation.minutes * MINUTE_MS };
}

function burdensFor(attendees: readonly Person[], start: number, end: number) {
  const out: Record<string, Burden> = {};
  for (const p of attendees) out[p.id] = burden(p, start, end);
  return out;
}

/** The held (not skipped) meetings, oldest first, with each attendee's burden on today's hours. */
export function heldOccurrences(
  rotation: TeamTimeRotation,
  people: readonly Person[]
): Occurrence[] {
  const attendees = rotationAttendees(rotation, people);
  const options = new Map(rotation.options.map((o) => [o.id, o]));
  const out: Occurrence[] = [];
  for (const h of rotation.held) {
    if (h.skipped) continue;
    const option = options.get(h.optionId);
    const cycle = cycleOf(rotation, h.date);
    if (!option || cycle === null) continue;
    const at = wallToUtc(h.date, option.time, option.timeZone);
    if (!at) continue;
    const start = at.getTime();
    const end = start + rotation.minutes * MINUTE_MS;
    out.push({
      cycle,
      date: h.date,
      optionId: option.id,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      burdens: burdensFor(attendees, start, end),
    });
  }
  return out;
}

/** The index of the option after `optionId` in turn (0 for an option that's gone). */
function turnAfter(rotation: TeamTimeRotation, optionId: string): number {
  const at = rotation.options.findIndex((o) => o.id === optionId);
  return at < 0 ? 0 : (at + 1) % rotation.options.length;
}

/** The turn after the last held (not skipped) meeting of a cycle before `before`: 0 with none. */
function turnBefore(rotation: TeamTimeRotation, before: number): number {
  let last: TeamTimeHeld | null = null;
  let lastCycle = -Infinity;
  for (const h of rotation.held) {
    if (h.skipped) continue;
    const c = cycleOf(rotation, h.date);
    if (c === null || c >= before) continue;
    if (c >= lastCycle) {
      lastCycle = c;
      last = h;
    }
  }
  return last ? turnAfter(rotation, last.optionId) : 0;
}

/** The meetings the plan walks through: past ones nobody marked (counted as held), and the ones ahead. */
interface Plan {
  presumed: Occurrence[];
  planned: Occurrence[];
}

/**
 * Walks the cycles in order. A cycle with a held or skipped row is done (a
 * held one takes the turn). Any other cycle gets its option, in turn or
 * fairest; when that meeting started more than a day ago it counts as held
 * (`presumed`), otherwise it is planned. It stops after `count` planned.
 */
function walk(
  rotation: TeamTimeRotation,
  people: readonly Person[],
  now: number,
  count: number,
  holidays: ReadonlySet<string>
): Plan {
  const plan: Plan = { presumed: [], planned: [] };
  const n = rotation.options.length;
  if (n === 0 || count <= 0) return plan;
  const attendees = rotationAttendees(rotation, people);
  const totals = new Map<string, number>();
  for (const p of attendees) totals.set(p.id, 0);
  const add = (burdens: Record<string, Burden>) => {
    for (const [id, b] of Object.entries(burdens)) totals.set(id, (totals.get(id) ?? 0) + b);
  };
  for (const h of heldOccurrences(rotation, people)) add(h.burdens);
  const marked = new Map<number, TeamTimeHeld[]>();
  for (const h of rotation.held) {
    const c = cycleOf(rotation, h.date);
    if (c !== null) marked.set(c, [...(marked.get(c) ?? []), h]);
  }
  const lastMarked = Math.max(-1, ...Array.from(marked.keys()));
  const shownFrom = now - MARK_GRACE_MS;
  const nowCycle = cycleOf(rotation, new Date(shownFrom).toISOString().slice(0, 10)) ?? 0;
  // Unmarked cycles from here on count their points; older ones only use their turn.
  const countFrom = nowCycle - PRESUMED_CYCLES;
  const first = Math.max(0, Math.min(lastMarked + 1, countFrom));
  const stop = Math.max(0, lastMarked + 1) + MAX_CYCLES;
  let turn = turnBefore(rotation, first);
  for (let k = first; k < stop && plan.planned.length < count; k++) {
    const marks = marked.get(k);
    if (marks) {
      const held = marks.filter((h) => !h.skipped).at(-1);
      if (held) turn = turnAfter(rotation, held.optionId);
      continue;
    }
    // Each option for this cycle, in turn order from the one due; in turn
    // only the one due, Fairest any of them.
    const order = Array.from({ length: n }, (_, i) => rotation.options[(turn + i) % n]);
    const candidates = order
      .map((option, i) => ({ option, i, at: occurrenceAt(rotation, k, option) }))
      .filter(
        (c): c is { option: TeamTimeRotationOption; i: number; at: NonNullable<typeof c.at> } =>
          c.at !== null && !holidays.has(c.at.date)
      )
      .filter((c) => rotation.mode === "fairest" || c.i === 0);
    if (candidates.length === 0) continue;
    const counted = k >= countFrom;
    let pick = candidates[0];
    let burdens: Record<string, Burden> | null = null;
    if (rotation.mode === "fairest" && counted) {
      let bestScore = Infinity;
      for (const c of candidates) {
        const b = burdensFor(attendees, c.at.start, c.at.end);
        let score = 0;
        for (const p of attendees) score = Math.max(score, (totals.get(p.id) ?? 0) + b[p.id]);
        if (score < bestScore) {
          bestScore = score;
          pick = c;
          burdens = b;
        }
      }
    }
    turn = (rotation.options.indexOf(pick.option) + 1) % n;
    const ahead = pick.at.start >= shownFrom;
    if (!ahead && !counted) continue;
    burdens ??= burdensFor(attendees, pick.at.start, pick.at.end);
    add(burdens);
    (ahead ? plan.planned : plan.presumed).push({
      cycle: k,
      date: pick.at.date,
      optionId: pick.option.id,
      start: new Date(pick.at.start).toISOString(),
      end: new Date(pick.at.end).toISOString(),
      burdens,
    });
  }
  return plan;
}

/** The last walk of each rotation: the page asks for its plan and its totals at the same time. */
const lastWalk = new WeakMap<
  TeamTimeRotation,
  { people: readonly Person[]; now: number; count: number; holidays: string; plan: Plan }
>();

function walkOnce(
  rotation: TeamTimeRotation,
  people: readonly Person[],
  from: Date | number,
  count: number,
  holidays: readonly string[] = []
): Plan {
  const now = typeof from === "number" ? from : from.getTime();
  const key = holidays.join(",");
  const hit = lastWalk.get(rotation);
  if (
    hit &&
    hit.people === people &&
    hit.now === now &&
    hit.count === count &&
    hit.holidays === key
  ) {
    return hit.plan;
  }
  const plan = walk(rotation, people, now, count, new Set(holidays));
  lastWalk.set(rotation, { people, now, count, holidays: key, plan });
  return plan;
}

/**
 * The next `count` meetings from `from` (a meeting that started less than a
 * day ago included), each with its option and every attendee's burden.
 * `holidays` are the team's days off ("YYYY-MM-DD"), skipped on the
 * option's clock. A past meeting nobody marked counts as held, so the plan
 * goes on after it.
 */
export function nextOccurrences(
  rotation: TeamTimeRotation,
  people: readonly Person[],
  from: Date | number,
  count = ROTATION_PLAN_COUNT,
  opts: { holidays?: readonly string[] } = {}
): Occurrence[] {
  return [...walkOnce(rotation, people, from, count, opts.holidays).planned];
}

/** Each attendee's late or night points, held plus planned, and the spread. */
export interface BurdenTotals {
  totals: { personId: string; points: number }[];
  /** All the points together. */
  total: number;
  /** The most anyone carries minus the least. */
  spread: number;
}

/**
 * Points per attendee over the held meetings (marked, or past with nobody
 * marking them) and the next `count` planned ones.
 */
export function burdenTotals(
  rotation: TeamTimeRotation,
  people: readonly Person[],
  from: Date | number,
  count = ROTATION_PLAN_COUNT,
  opts: { holidays?: readonly string[] } = {}
): BurdenTotals {
  const attendees = rotationAttendees(rotation, people);
  const points = new Map<string, number>(attendees.map((p) => [p.id, 0]));
  const add = (o: Occurrence) => {
    for (const [id, b] of Object.entries(o.burdens)) {
      if (points.has(id)) points.set(id, (points.get(id) ?? 0) + b);
    }
  };
  const plan = walkOnce(rotation, people, from, count, opts.holidays);
  heldOccurrences(rotation, people).forEach(add);
  plan.presumed.forEach(add);
  plan.planned.forEach(add);
  const totals = attendees.map((p) => ({ personId: p.id, points: points.get(p.id) ?? 0 }));
  const values = totals.map((t) => t.points);
  return {
    totals,
    total: values.reduce((a, b) => a + b, 0),
    spread: values.length > 0 ? Math.max(...values) - Math.min(...values) : 0,
  };
}

/**
 * The fairness line under the plan: who carries most of the late and night
 * points, and where a new time would help ("Lee carries 6 of 8 late or
 * night points. Add a time that suits Sydney."), or that it's shared.
 */
export function fairnessLine(
  totals: BurdenTotals,
  name: (personId: string) => string,
  place: (personId: string) => string
): string {
  if (totals.total === 0) return "Every meeting falls in everyone's working hours.";
  const top = [...totals.totals].sort((a, b) => b.points - a.points)[0];
  if (top && top.points * 2 > totals.total && totals.totals.length > 1) {
    return `${name(top.personId)} carries ${top.points} of ${totals.total} late or night points. Add a time that suits ${place(top.personId)}.`;
  }
  const most = top?.points ?? 0;
  return `The late and night calls are shared: the most anyone carries is ${most} of ${totals.total} points.`;
}
