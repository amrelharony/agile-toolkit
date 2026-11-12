/**
 * Facilitator Timers: the timers a session needs beyond its agenda.
 *
 *   - Pomodoro: focus blocks and short breaks, a number of rounds;
 *   - Break: one countdown to a time to be back ("Back at 10:45"), set as a
 *     clock time or a number of minutes;
 *   - Crazy 8s: eight one-minute sketching rounds (or as set), a cue each;
 *   - the meeting cost ticker: people × a rough hourly rate × time.
 *
 * A timer run is a list of steps and the one that's on; the docked timer
 * (lib/timer/dock-timer) is the clock of that step, so it keeps counting
 * while the facilitator opens another tool. Pure: no store, no clock of its
 * own (`now` comes in), no React. Safe to call from the agent's actions on
 * the server.
 */

import type { DockedTimer } from "@/lib/timer/dock-timer";

/** The page that owns the facilitator timers' docked timer. */
export const FT_HREF = "/facilitator-timers";

export const TIMER_KINDS = ["pomodoro", "break", "crazy-8s"] as const;
export type TimerKind = (typeof TIMER_KINDS)[number];

export const TIMER_TITLE: Record<TimerKind, string> = {
  pomodoro: "Pomodoro",
  break: "Break",
  "crazy-8s": "Crazy 8s",
};

export function isTimerKind(value: unknown): value is TimerKind {
  return TIMER_KINDS.includes(value as TimerKind);
}

/** What a step is for: focus work, a short rest, a sketch round, a break. */
export type StepKind = "focus" | "rest" | "sketch" | "break";

export interface TimerStep {
  id: string;
  label: string;
  seconds: number;
  kind: StepKind;
}

export interface TimerRun {
  kind: TimerKind;
  /** "Pomodoro", "Break", "Crazy 8s". */
  title: string;
  steps: TimerStep[];
  /** The step that's on (the last once finished). */
  index: number;
  finished: boolean;
  /** A break's return time, epoch ms. */
  backAt?: number;
}

/* -------------------------------------------------------------------------- */
/*  Settings and their limits                                                  */
/* -------------------------------------------------------------------------- */

export interface PomodoroSettings {
  workMinutes: number;
  breakMinutes: number;
  rounds: number;
}

export interface Crazy8sSettings {
  rounds: number;
  roundSeconds: number;
}

export const LIMITS = {
  workMinutes: { min: 1, max: 120 },
  breakMinutes: { min: 1, max: 60 },
  rounds: { min: 1, max: 12 },
  breakScreenMinutes: { min: 1, max: 240 },
  sketchRounds: { min: 1, max: 12 },
  roundSeconds: { min: 15, max: 600 },
  attendees: { min: 1, max: 500 },
  hourlyRate: { min: 0.01, max: 100_000 },
} as const;

/** A break can be set to end up to this far ahead. */
export const MAX_BREAK_AHEAD_MS = 12 * 3600 * 1000;

export const DEFAULT_POMODORO: PomodoroSettings = { workMinutes: 25, breakMinutes: 5, rounds: 4 };
export const DEFAULT_CRAZY_8S: Crazy8sSettings = { rounds: 8, roundSeconds: 60 };
export const DEFAULT_BREAK_MINUTES = 10;

/** `value` as a whole number within `range`, or `fallback`. */
function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

export function normalizePomodoro(raw: unknown): PomodoroSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    workMinutes: clampInt(r.workMinutes, LIMITS.workMinutes, DEFAULT_POMODORO.workMinutes),
    breakMinutes: clampInt(r.breakMinutes, LIMITS.breakMinutes, DEFAULT_POMODORO.breakMinutes),
    rounds: clampInt(r.rounds, LIMITS.rounds, DEFAULT_POMODORO.rounds),
  };
}

export function normalizeCrazy8s(raw: unknown): Crazy8sSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    rounds: clampInt(r.rounds, LIMITS.sketchRounds, DEFAULT_CRAZY_8S.rounds),
    roundSeconds: clampInt(r.roundSeconds, LIMITS.roundSeconds, DEFAULT_CRAZY_8S.roundSeconds),
  };
}

export function normalizeBreakMinutes(raw: unknown): number {
  return clampInt(raw, LIMITS.breakScreenMinutes, DEFAULT_BREAK_MINUTES);
}

/* -------------------------------------------------------------------------- */
/*  Steps                                                                      */
/* -------------------------------------------------------------------------- */

/** Focus 1, break, focus 2, break, …, focus N: no break after the last focus block. */
export function pomodoroSteps(settings: PomodoroSettings): TimerStep[] {
  const s = normalizePomodoro(settings);
  const steps: TimerStep[] = [];
  for (let i = 1; i <= s.rounds; i++) {
    steps.push({
      id: `focus-${i}`,
      label: `Focus ${i} of ${s.rounds}`,
      seconds: s.workMinutes * 60,
      kind: "focus",
    });
    if (i < s.rounds) {
      steps.push({
        id: `rest-${i}`,
        label: `Short break ${i} of ${s.rounds - 1}`,
        seconds: s.breakMinutes * 60,
        kind: "rest",
      });
    }
  }
  return steps;
}

export function crazy8sSteps(settings: Crazy8sSettings): TimerStep[] {
  const s = normalizeCrazy8s(settings);
  return Array.from({ length: s.rounds }, (_, i) => ({
    id: `sketch-${i + 1}`,
    label: `Sketch ${i + 1} of ${s.rounds}`,
    seconds: s.roundSeconds,
    kind: "sketch" as const,
  }));
}

/** The whole run's planned seconds. */
export function stepsSeconds(steps: readonly Pick<TimerStep, "seconds">[]): number {
  return steps.reduce((sum, s) => sum + Math.max(0, s.seconds), 0);
}

/** A run of `kind` at its first step. */
export function newRun(kind: TimerKind, steps: TimerStep[], backAt?: number): TimerRun {
  return {
    kind,
    title: TIMER_TITLE[kind],
    steps,
    index: 0,
    finished: steps.length === 0,
    ...(backAt !== undefined ? { backAt } : {}),
  };
}

/** A break run that ends at `backAt` (epoch ms), from `now`. */
export function breakRun(backAt: number, now: number): TimerRun {
  const seconds = Math.max(1, Math.round((backAt - now) / 1000));
  return newRun("break", [{ id: "break", label: "Break", seconds, kind: "break" }], backAt);
}

export const currentStep = (run: TimerRun): TimerStep | undefined =>
  run.finished ? undefined : run.steps[run.index];

/** The run moved on a step; past the last one it is finished. */
export function nextStep(run: TimerRun): TimerRun {
  if (run.finished) return run;
  const index = run.index + 1;
  return index >= run.steps.length
    ? { ...run, index: run.steps.length - 1, finished: true }
    : { ...run, index };
}

/** Whether the run moves on by itself when a step's time is up (a break just ends). */
export function autoAdvances(run: TimerRun): boolean {
  return run.kind === "pomodoro" || run.kind === "crazy-8s";
}

/** The dock's label for the step that's on: "Crazy 8s · Sketch 3 of 8", or "Break". */
export function dockLabel(run: TimerRun): string {
  const step = currentStep(run);
  if (!step || run.steps.length === 1) return run.title;
  return `${run.title} · ${step.label}`;
}

/**
 * The docked timer for the step that's on, running from `now` (a break
 * counts down to its return time); null once the run is finished.
 */
export function stepDock(run: TimerRun, now: number): DockedTimer | null {
  const step = currentStep(run);
  if (!step) return null;
  const endsAt =
    run.kind === "break" && run.backAt !== undefined ? run.backAt : now + step.seconds * 1000;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return {
    label: dockLabel(run),
    href: FT_HREF,
    totalSeconds: Math.max(left, step.seconds),
    endsAt,
    pausedRemaining: left,
  };
}

/**
 * A stored run the page can carry on with, or null: a known kind, steps it
 * would have built itself (lengths within the limits), an index in range.
 */
export function normalizeRun(raw: unknown): TimerRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isTimerKind(r.kind) || !Array.isArray(r.steps) || r.steps.length === 0) return null;
  if (r.steps.length > 40) return null;
  const steps: TimerStep[] = [];
  for (const row of r.steps) {
    if (!row || typeof row !== "object") return null;
    const s = row as Record<string, unknown>;
    const kind = s.kind;
    if (typeof s.id !== "string" || typeof s.label !== "string") return null;
    if (kind !== "focus" && kind !== "rest" && kind !== "sketch" && kind !== "break") return null;
    if (typeof s.seconds !== "number" || !Number.isFinite(s.seconds) || s.seconds <= 0) return null;
    if (s.seconds > 24 * 3600) return null;
    steps.push({
      id: s.id.slice(0, 40),
      label: s.label.slice(0, 60),
      seconds: Math.round(s.seconds),
      kind,
    });
  }
  const index = Number.isInteger(r.index)
    ? Math.min(Math.max(0, r.index as number), steps.length - 1)
    : 0;
  const backAt = typeof r.backAt === "number" && Number.isFinite(r.backAt) ? r.backAt : undefined;
  return {
    kind: r.kind,
    title: TIMER_TITLE[r.kind],
    steps,
    index,
    finished: r.finished === true,
    ...(r.kind === "break" && backAt !== undefined ? { backAt } : {}),
  };
}

/**
 * When a break ends, as its clock (the docked timer) says: the dock's end
 * while it runs; while paused, now plus the time left, which is where it
 * would end if resumed now; at zero, or without the dock, the return time
 * the run keeps (moved on each resume, so it is the real end).
 */
export function breakEndsAt(
  run: TimerRun,
  dock: DockedTimer | null,
  now: number
): number | undefined {
  if (run.kind !== "break") return undefined;
  if (dock?.href === FT_HREF) {
    if (dock.endsAt !== null) return dock.endsAt;
    if (dock.pausedRemaining > 0) return now + dock.pausedRemaining * 1000;
  }
  return run.backAt;
}

/** Whether the run's step is paused on the dock with time still to go. */
export function dockPaused(dock: DockedTimer | null): boolean {
  return Boolean(dock?.href === FT_HREF && dock.endsAt === null && dock.pausedRemaining > 0);
}

/**
 * Whether a stored run is still on: one whose dock is no longer this
 * page's was stopped from the pill on another page, or replaced there. A
 * finished run has no dock and stays until it is closed.
 */
export function runIsLive(run: TimerRun | null, dock: DockedTimer | null): boolean {
  if (!run) return false;
  return run.finished || dock?.href === FT_HREF;
}

/* -------------------------------------------------------------------------- */
/*  Breaks: "Back at 10:45"                                                    */
/* -------------------------------------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");

/** A time of day on the 24-hour clock, local: "10:45". */
export function clockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type BackAtResult = { ok: true; at: number } | { ok: false; error: string };

/**
 * The next time `hhmm` ("10:45", "9:05") comes round, local time, as epoch
 * ms: today if it's still ahead, else tomorrow, and never more than twelve
 * hours ahead (a time that far off is most likely a typo for one that has
 * just passed).
 */
export function backAtFromClock(hhmm: string, now: number): BackAtResult {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hhmm);
  if (!m) return { ok: false, error: "Enter a time such as 10:45." };
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return { ok: false, error: "Enter a time such as 10:45." };
  const at = new Date(now);
  at.setHours(h, min, 0, 0);
  let t = at.getTime();
  const passed = t <= now;
  if (passed) {
    at.setDate(at.getDate() + 1);
    t = at.getTime();
  }
  if (t - now > MAX_BREAK_AHEAD_MS) {
    return {
      ok: false,
      error: passed
        ? `${pad(h)}:${pad(min)} has passed. Enter a time later today.`
        : "Pick a time within the next 12 hours.",
    };
  }
  if (t - now < 60_000) return { ok: false, error: "Pick a time at least a minute from now." };
  return { ok: true, at: t };
}

/** Back in `minutes` from `now`, as epoch ms. */
export function backAtFromMinutes(minutes: number, now: number): number {
  return now + Math.round(minutes * 60) * 1000;
}

/* -------------------------------------------------------------------------- */
/*  The meeting cost ticker                                                    */
/* -------------------------------------------------------------------------- */

/** The ticker's clock: active milliseconds, anchored to the wall clock while it runs. */
export interface CostClock {
  baseMs: number;
  /** Epoch ms when it last started; null while paused. */
  since: number | null;
}

export function costElapsedMs(clock: CostClock, now: number): number {
  return Math.max(0, clock.baseMs + (clock.since === null ? 0 : Math.max(0, now - clock.since)));
}

export function startCostClock(clock: CostClock | null, now: number): CostClock {
  if (!clock) return { baseMs: 0, since: now };
  return clock.since === null ? { ...clock, since: now } : clock;
}

export function pauseCostClock(clock: CostClock, now: number): CostClock {
  return clock.since === null ? clock : { baseMs: costElapsedMs(clock, now), since: null };
}

/** People × hourly rate × hours. */
export function meetingCost(attendees: number, hourlyRate: number, seconds: number): number {
  if (![attendees, hourlyRate, seconds].every((n) => Number.isFinite(n) && n >= 0)) return 0;
  return (attendees * hourlyRate * seconds) / 3600;
}

/** People × hours: what the meeting used, without any money in it. */
export function personHours(attendees: number, seconds: number): number {
  if (!Number.isFinite(attendees) || !Number.isFinite(seconds)) return 0;
  return Math.max(0, (attendees * seconds) / 3600);
}

/** What one more minute costs. */
export function costPerMinute(attendees: number, hourlyRate: number): number {
  return meetingCost(attendees, hourlyRate, 60);
}

/** A three-letter currency code the browser can format ("EUR"), upper-cased, or null. */
export function currencyCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return code;
  } catch {
    return null;
  }
}

/**
 * An amount in the person's currency: formatted by the browser for a code
 * it knows ("€1,234.50"), else the number with what they typed after it
 * ("1,234.50 credits").
 */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const code = currencyCode(currency);
  if (code) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
      minimumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value);
  }
  const n = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
  const unit = currency.trim();
  return unit ? `${n} ${unit}` : n;
}

/** "4.5 person-hours", "1 person-hour". */
export function personHoursText(hours: number): string {
  const h = Math.round(hours * 10) / 10;
  return `${h} person-${h === 1 ? "hour" : "hours"}`;
}

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** A length in words: "25 min", "1 h 55 min", "45 s". */
export function lengthText(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h === 0) return sec ? `${m} min ${sec} s` : `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The plan of a run in one line: "4 × 25 min focus with 5 min breaks (1 h 55 min)". */
export function planText(
  kind: TimerKind,
  settings: {
    pomodoro: PomodoroSettings;
    crazy8s: Crazy8sSettings;
    breakMinutes: number;
  }
): string {
  if (kind === "pomodoro") {
    const p = normalizePomodoro(settings.pomodoro);
    const total = lengthText(stepsSeconds(pomodoroSteps(p)));
    if (p.rounds === 1) return `One ${p.workMinutes} min focus block`;
    return `${p.rounds} × ${p.workMinutes} min focus with ${p.breakMinutes} min breaks (${total})`;
  }
  if (kind === "crazy-8s") {
    const c = normalizeCrazy8s(settings.crazy8s);
    return `${c.rounds} sketches, ${lengthText(c.roundSeconds)} each (${lengthText(c.rounds * c.roundSeconds)})`;
  }
  return `A ${normalizeBreakMinutes(settings.breakMinutes)} min break`;
}
