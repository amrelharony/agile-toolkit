/**
 * A meeting that rotates between times, so the same people don't always
 * take the late call. Pure and server-safe; the page and Amr's verbs plan
 * the same occurrences.
 *
 * - Cycle k starts on `startDate + 7 × everyWeeks × k` days. Its meeting is
 *   on the first day on or after that with the option's weekday, at the
 *   option's time on the option's clock (`wallToUtc` on the real date).
 * - A held row belongs to the cycle its date falls in. The plan goes on
 *   from the cycle after the last held one; a meeting that started less
 *   than a day ago still shows, so it can be marked held or skipped.
 * - "In turn" goes round the options, from the one after the last held.
 *   "Fairest" picks the option that keeps the highest running total (held
 *   plus planned) lowest, the in-turn order breaking ties.
 * - A skipped meeting counts nothing and uses no turn: the next takes the
 *   same option. A team holiday (on the option's clock) is skipped the same
 *   way, as the ceremony dates skip it.
 */

import { isoDayNumber, isoFromDayNumber, weekdayOf } from "@/lib/sprints/calendar";
import type {
  TeamTimeHeld,
  TeamTimePerson,
  TeamTimeRotation,
  TeamTimeRotationOption,
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

/** The index of the option after the last held (not skipped) meeting's, in turn: 0 with none. */
function nextTurn(rotation: TeamTimeRotation): number {
  const n = rotation.options.length;
  let last: TeamTimeHeld | null = null;
  let lastCycle = -Infinity;
  for (const h of rotation.held) {
    if (h.skipped) continue;
    const c = cycleOf(rotation, h.date) ?? -Infinity;
    if (c >= lastCycle) {
      lastCycle = c;
      last = h;
    }
  }
  if (!last || n === 0) return 0;
  const at = rotation.options.findIndex((o) => o.id === last!.optionId);
  return at < 0 ? 0 : (at + 1) % n;
}

/** The last cycle a held or skipped row covers, or -1 with none. */
function lastMarkedCycle(rotation: TeamTimeRotation): number {
  let last = -1;
  for (const h of rotation.held) {
    const c = cycleOf(rotation, h.date);
    if (c !== null && c > last) last = c;
  }
  return last;
}

/**
 * The next `count` meetings from `from` (a meeting that started less than a
 * day ago included), each with its option and every attendee's burden.
 * `holidays` are the team's days off ("YYYY-MM-DD"), skipped on the
 * option's clock.
 */
export function nextOccurrences(
  rotation: TeamTimeRotation,
  people: readonly Person[],
  from: Date | number,
  count = ROTATION_PLAN_COUNT,
  opts: { holidays?: readonly string[] } = {}
): Occurrence[] {
  const n = rotation.options.length;
  if (n === 0 || count <= 0) return [];
  const now = typeof from === "number" ? from : from.getTime();
  const holidays = new Set(opts.holidays ?? []);
  const attendees = rotationAttendees(rotation, people);
  const totals = new Map<string, number>();
  for (const p of attendees) totals.set(p.id, 0);
  for (const h of heldOccurrences(rotation, people)) {
    for (const [id, b] of Object.entries(h.burdens)) totals.set(id, (totals.get(id) ?? 0) + b);
  }
  let turn = nextTurn(rotation);
  const out: Occurrence[] = [];
  const firstCycle = Math.max(0, lastMarkedCycle(rotation) + 1);
  for (let k = firstCycle; k < firstCycle + MAX_CYCLES && out.length < count; k++) {
    // Each option for this cycle, in turn order from the one due; in turn
    // only the one due, Fairest any whose meeting is still ahead.
    const order = Array.from({ length: n }, (_, i) => rotation.options[(turn + i) % n]);
    const open = order
      .map((option, i) => ({ option, i, at: occurrenceAt(rotation, k, option) }))
      .filter(
        (c): c is { option: TeamTimeRotationOption; i: number; at: NonNullable<typeof c.at> } =>
          c.at !== null && c.at.start >= now - MARK_GRACE_MS && !holidays.has(c.at.date)
      )
      .filter((c) => rotation.mode === "fairest" || c.i === 0);
    if (open.length === 0) continue;
    let pick = open[0];
    let pickedBurdens = burdensFor(attendees, pick.at.start, pick.at.end);
    if (rotation.mode === "fairest") {
      let bestScore = Infinity;
      for (const c of open) {
        const burdens = burdensFor(attendees, c.at.start, c.at.end);
        let score = 0;
        for (const p of attendees) {
          score = Math.max(score, (totals.get(p.id) ?? 0) + burdens[p.id]);
        }
        if (score < bestScore) {
          bestScore = score;
          pick = c;
          pickedBurdens = burdens;
        }
      }
    }
    const picked = { ...pick.at, burdens: pickedBurdens };
    const option = pick.option;
    for (const [id, b] of Object.entries(picked.burdens)) totals.set(id, (totals.get(id) ?? 0) + b);
    out.push({
      cycle: k,
      date: picked.date,
      optionId: option.id,
      start: new Date(picked.start).toISOString(),
      end: new Date(picked.end).toISOString(),
      burdens: picked.burdens,
    });
    turn = (rotation.options.indexOf(option) + 1) % n;
  }
  return out;
}

/** Each attendee's late or night points, held plus planned, and the spread. */
export interface BurdenTotals {
  totals: { personId: string; points: number }[];
  /** All the points together. */
  total: number;
  /** The most anyone carries minus the least. */
  spread: number;
}

/** Points per attendee over the held meetings and the next `count` planned ones. */
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
  heldOccurrences(rotation, people).forEach(add);
  nextOccurrences(rotation, people, from, count, opts).forEach(add);
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
