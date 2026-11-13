/**
 * Facilitator Timers' forms, checked before anything starts or is saved:
 * a blank or out-of-range value is an error to fix, never a default
 * filled in for the person. Pure, for the page and its tests.
 */

import {
  LIMITS,
  backAtFromClock,
  backAtFromMinutes,
  type Crazy8sSettings,
  type PomodoroSettings,
} from "@/lib/facilitator-timers/model";
import { AGENDA_GOAL_MAX } from "@/lib/facilitator-timers/store";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";

const RANGE_TEXT = (r: { min: number; max: number }) => `from ${r.min} to ${r.max}`;

/** A whole number in `range`, or the error to show. */
function wholeIn(
  raw: string,
  range: { min: number; max: number },
  what: string
): { value: number } | { error: string } {
  const n = parseNumber(raw);
  if (n === undefined) return { error: `Enter the ${what}.` };
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < range.min || n > range.max) {
    return { error: `Enter a whole number ${RANGE_TEXT(range)}.` };
  }
  return { value: n };
}

function collect<K extends string, V>(
  checks: Record<K, { value: number } | { error: string }>,
  build: (values: Record<K, number>) => V
): Validation<V, K> {
  const errors: FormErrors<K> = {};
  const values = {} as Record<K, number>;
  for (const key of Object.keys(checks) as K[]) {
    const c = checks[key];
    if ("error" in c) errors[key] = c.error;
    else values[key] = c.value;
  }
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, values: build(values) };
}

export interface PomodoroDraft {
  workMinutes: string;
  breakMinutes: string;
  rounds: string;
}

export const pomodoroDraft = (s: PomodoroSettings): PomodoroDraft => ({
  workMinutes: String(s.workMinutes),
  breakMinutes: String(s.breakMinutes),
  rounds: String(s.rounds),
});

export function validatePomodoro(
  d: PomodoroDraft
): Validation<PomodoroSettings, keyof PomodoroDraft> {
  return collect(
    {
      workMinutes: wholeIn(d.workMinutes, LIMITS.workMinutes, "focus minutes"),
      breakMinutes: wholeIn(d.breakMinutes, LIMITS.breakMinutes, "break minutes"),
      rounds: wholeIn(d.rounds, LIMITS.rounds, "number of rounds"),
    },
    (v) => ({ workMinutes: v.workMinutes, breakMinutes: v.breakMinutes, rounds: v.rounds })
  );
}

export interface Crazy8sDraft {
  rounds: string;
  roundSeconds: string;
}

export const crazy8sDraft = (s: Crazy8sSettings): Crazy8sDraft => ({
  rounds: String(s.rounds),
  roundSeconds: String(s.roundSeconds),
});

export function validateCrazy8s(d: Crazy8sDraft): Validation<Crazy8sSettings, keyof Crazy8sDraft> {
  return collect(
    {
      rounds: wholeIn(d.rounds, LIMITS.sketchRounds, "number of sketches"),
      roundSeconds: wholeIn(d.roundSeconds, LIMITS.roundSeconds, "seconds per sketch"),
    },
    (v) => ({ rounds: v.rounds, roundSeconds: v.roundSeconds })
  );
}

/** A break set as a number of minutes, or as the time to be back. */
export interface BreakDraft {
  mode: "minutes" | "clock";
  minutes: string;
  clock: string;
}

export interface BreakValues {
  /** Epoch ms to be back at. */
  backAt: number;
  /** The minutes typed, when the break was set in minutes (they become the default). */
  minutes?: number;
}

export function validateBreak(
  d: BreakDraft,
  now: number
): Validation<BreakValues, "minutes" | "clock"> {
  if (d.mode === "clock") {
    if (!d.clock.trim()) return { ok: false, errors: { clock: "Enter the time to be back." } };
    const at = backAtFromClock(d.clock, now);
    return at.ok
      ? { ok: true, values: { backAt: at.at } }
      : { ok: false, errors: { clock: at.error } };
  }
  const m = wholeIn(d.minutes, LIMITS.breakScreenMinutes, "minutes");
  if ("error" in m) return { ok: false, errors: { minutes: m.error } };
  return { ok: true, values: { backAt: backAtFromMinutes(m.value, now), minutes: m.value } };
}

export interface CostDraft {
  attendees: string;
  hourlyRate: string;
  currency: string;
}

export interface CostValues {
  attendees: number;
  hourlyRate: number;
  currency: string;
}

/** People, a rough hourly rate and a currency: all three needed, nothing assumed. */
export function validateCost(d: CostDraft): Validation<CostValues, keyof CostDraft> {
  const errors: FormErrors<keyof CostDraft> = {};
  const people = wholeIn(d.attendees, LIMITS.attendees, "number of people");
  if ("error" in people) errors.attendees = people.error;
  const rate = parseNumber(d.hourlyRate);
  if (rate === undefined) errors.hourlyRate = "Enter a rough hourly rate.";
  else if (!Number.isFinite(rate) || rate < LIMITS.hourlyRate.min || rate > LIMITS.hourlyRate.max) {
    errors.hourlyRate = `Enter a rate above 0 and up to ${LIMITS.hourlyRate.max.toLocaleString("en")}.`;
  }
  const currency = d.currency.trim();
  if (!currency) errors.currency = "Enter a currency, such as EUR.";
  else if (currency.length > 8) errors.currency = "Keep it to 8 characters, such as EUR.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      attendees: (people as { value: number }).value,
      hourlyRate: rate as number,
      currency,
    },
  };
}

export interface AgendaRequestDraft {
  goal: string;
  minutes: string;
}

/** What the agenda draft needs: the meeting's goal and its length. */
export function validateAgendaRequest(
  d: AgendaRequestDraft
): Validation<{ goal: string; minutes: number }, keyof AgendaRequestDraft> {
  const errors: FormErrors<keyof AgendaRequestDraft> = {};
  const goal = d.goal.trim();
  if (goal.length < 3) errors.goal = "Say what the meeting is for, in a few words.";
  else if (goal.length > AGENDA_GOAL_MAX) errors.goal = `Keep it to ${AGENDA_GOAL_MAX} characters.`;
  const minutes = wholeIn(d.minutes, { min: 5, max: 480 }, "minutes");
  if ("error" in minutes) errors.minutes = minutes.error;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { goal, minutes: (minutes as { value: number }).value } };
}
