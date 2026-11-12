/**
 * Facilitator Timers' stores and the docked-timer moves that go with them.
 *
 * - Settings (`agile-toolkit:facilitator-timers`, synced like other tool
 *   stores): the timers' lengths, the opt-in chime, the focus sound's choice
 *   and volume (never whether it plays), whether the soundboard shows while
 *   presenting, and the agenda being drafted for the Ceremony Timer.
 * - Session (sessionStorage, per tab like the docked timer): the timer run
 *   on, so leaving the page or reloading keeps it.
 * - Cost (sessionStorage only, never synced or sent anywhere): the meeting
 *   cost ticker's people, rate, currency and clock. A rate is personal, so
 *   it stays in this browser tab.
 *
 * A plain module (no "use client"): the agent's actions import it. They
 * call the store only in the browser; over MCP they read the synced
 * settings row instead (lib/actions/tools/facilitator-timers.ts).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { claimDock, useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";
import {
  DEFAULT_BREAK_MINUTES,
  DEFAULT_CRAZY_8S,
  DEFAULT_POMODORO,
  FT_HREF,
  nextStep,
  normalizeBreakMinutes,
  normalizeCrazy8s,
  normalizePomodoro,
  normalizeRun,
  stepDock,
  type CostClock,
  type Crazy8sSettings,
  type PomodoroSettings,
  type TimerRun,
} from "./model";
import { isFocusSound, type FocusSound } from "./sounds";

/* -------------------------------------------------------------------------- */
/*  Settings                                                                   */
/* -------------------------------------------------------------------------- */

/** One segment of the agenda being drafted, in minutes. */
export interface DraftSegment {
  id: string;
  label: string;
  minutes: number;
  hint: string;
}

export interface AgendaDraftState {
  /** What the meeting is for. */
  goal: string;
  /** How long it runs, in minutes; null until set. */
  minutes: number | null;
  segments: DraftSegment[];
}

export interface FacilitatorSettings {
  pomodoro: PomodoroSettings;
  /** The break screen's length when it is set in minutes. */
  breakMinutes: number;
  crazy8s: Crazy8sSettings;
  /** Chime (and vibrate) when a step's time is up. Off unless turned on. */
  chime: boolean;
  focusSound: FocusSound;
  /** 0–1. */
  focusVolume: number;
  /** Show the soundboard as a small dock while presenting, on any tool. */
  soundboardWhilePresenting: boolean;
  agenda: AgendaDraftState;
}

export const SETTINGS_KEY = "agile-toolkit:facilitator-timers";

export const AGENDA_GOAL_MAX = 280;
export const DRAFT_LABEL_MAX = 60;
export const DRAFT_HINT_MAX = 200;
export const DRAFT_MAX_SEGMENTS = 12;

export const FT_SETTINGS_INITIAL: FacilitatorSettings = {
  pomodoro: DEFAULT_POMODORO,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  crazy8s: DEFAULT_CRAZY_8S,
  chime: false,
  focusSound: "rain",
  focusVolume: 0.5,
  soundboardWhilePresenting: false,
  agenda: { goal: "", minutes: null, segments: [] },
};

export const useFacilitatorSettings = createPersistedStore<FacilitatorSettings>(
  "facilitator-timers",
  FT_SETTINGS_INITIAL
);

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The draft's segments made safe to use: an id, a name and a length each; ids once. */
export function normalizeDraftSegments(raw: unknown): DraftSegment[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const out: DraftSegment[] = [];
  for (const row of raw) {
    if (out.length >= DRAFT_MAX_SEGMENTS) break;
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || !/^[a-z0-9-]{1,60}$/.test(r.id) || ids.has(r.id)) continue;
    const label = text(r.label, DRAFT_LABEL_MAX);
    const minutes = typeof r.minutes === "number" && Number.isFinite(r.minutes) ? r.minutes : 0;
    if (!label || minutes < 0.5 || minutes > 480) continue;
    ids.add(r.id);
    out.push({
      id: r.id,
      label,
      minutes: Math.round(minutes * 2) / 2,
      hint: text(r.hint, DRAFT_HINT_MAX),
    });
  }
  return out;
}

export function normalizeAgendaDraft(raw: unknown): AgendaDraftState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const minutes =
    typeof r.minutes === "number" &&
    Number.isFinite(r.minutes) &&
    r.minutes >= 5 &&
    r.minutes <= 480
      ? Math.round(r.minutes)
      : null;
  return {
    goal: text(r.goal, AGENDA_GOAL_MAX),
    minutes,
    segments: normalizeDraftSegments(r.segments),
  };
}

/** The stored settings made safe to use (a synced or hand-edited value can hold anything). */
export function normalizeSettings(raw: unknown): FacilitatorSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const volume =
    typeof r.focusVolume === "number" && Number.isFinite(r.focusVolume)
      ? Math.min(1, Math.max(0, r.focusVolume))
      : FT_SETTINGS_INITIAL.focusVolume;
  return {
    pomodoro: normalizePomodoro(r.pomodoro),
    breakMinutes: normalizeBreakMinutes(r.breakMinutes),
    crazy8s: normalizeCrazy8s(r.crazy8s),
    chime: r.chime === true,
    focusSound: isFocusSound(r.focusSound) ? r.focusSound : FT_SETTINGS_INITIAL.focusSound,
    focusVolume: volume,
    soundboardWhilePresenting: r.soundboardWhilePresenting === true,
    agenda: normalizeAgendaDraft(r.agenda),
  };
}

/** Read the settings now (the page and the presenting dock rehydrate first). */
export function facilitatorSettings(): FacilitatorSettings {
  return normalizeSettings(useFacilitatorSettings.getState());
}

/** Load the stored settings once; the server render and first client render agree until then. */
export function hydrateFacilitatorSettings(): void {
  if (!useFacilitatorSettings.persist.hasHydrated())
    void useFacilitatorSettings.persist.rehydrate();
}

/* -------------------------------------------------------------------------- */
/*  Session: the timer run on                                                  */
/* -------------------------------------------------------------------------- */

export interface FtSession {
  run: TimerRun | null;
}

export const SESSION_KEY = "agile-toolkit:facilitator-timers:session";

export const useFtSession = create<FtSession>()(
  persist((): FtSession => ({ run: null }), {
    name: SESSION_KEY,
    storage: createJSONStorage(() => sessionStorage),
    skipHydration: true,
    merge: (persisted, current) => ({
      ...current,
      run: normalizeRun((persisted as Record<string, unknown> | null)?.run),
    }),
  })
);

export function hydrateFtSession(): void {
  if (!useFtSession.persist.hasHydrated()) void useFtSession.persist.rehydrate();
}

export type TimerClaim = { ok: true; run: TimerRun } | { ok: false; holder: DockedTimer };

/** The docked timer when another page holds it, else null. */
export function otherDock(timer: DockedTimer | null = useDockTimer.getState().timer) {
  return timer && timer.href !== FT_HREF ? timer : null;
}

/**
 * Start `run` from its first step on the dock, from `now`, unless another
 * page holds the dock: a ceremony's clock is never replaced. A facilitator
 * timer already on is replaced.
 */
export function startTimerRun(run: TimerRun, now: number = Date.now()): TimerClaim {
  const dock = stepDock(run, now);
  if (!dock) return { ok: true, run };
  const claim = claimDock(dock);
  if (!claim.ok) return claim;
  useFtSession.setState({ run });
  return { ok: true, run };
}

/**
 * The next step, its countdown from `now`; past the last step the run is
 * finished and the dock is freed. Null when no run is on.
 */
export function advanceTimerRun(now: number = Date.now()): TimerClaim | null {
  const { run } = useFtSession.getState();
  if (!run || run.finished) return null;
  const next = nextStep(run);
  if (next.finished) {
    releaseDock();
    useFtSession.setState({ run: next });
    return { ok: true, run: next };
  }
  const dock = stepDock(next, now);
  const claim = dock ? claimDock(dock) : null;
  if (claim && !claim.ok) return claim;
  useFtSession.setState({ run: next });
  return { ok: true, run: next };
}

export function pauseTimerRun(now: number = Date.now()): void {
  const dock = useDockTimer.getState();
  if (dock.timer?.href === FT_HREF) dock.pause(now);
}

export function resumeTimerRun(now: number = Date.now()): void {
  const dock = useDockTimer.getState();
  if (dock.timer?.href === FT_HREF) dock.resume(now);
}

/** End the run and free the dock (another page's timer is left alone). */
export function stopTimerRun(): void {
  releaseDock();
  useFtSession.setState({ run: null });
}

function releaseDock(): void {
  const dock = useDockTimer.getState();
  if (dock.timer?.href === FT_HREF) dock.stop();
}

/* -------------------------------------------------------------------------- */
/*  The meeting cost ticker (this tab only)                                    */
/* -------------------------------------------------------------------------- */

export interface CostTicker {
  attendees: number | null;
  hourlyRate: number | null;
  currency: string;
  clock: CostClock | null;
}

export const COST_KEY = "agile-toolkit:facilitator-timers:cost";

export const COST_INITIAL: CostTicker = {
  attendees: null,
  hourlyRate: null,
  currency: "",
  clock: null,
};

export function normalizeCost(raw: unknown): CostTicker {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pos = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : null;
  const c = r.clock as Record<string, unknown> | null | undefined;
  const clock =
    c && typeof c === "object" && typeof c.baseMs === "number" && Number.isFinite(c.baseMs)
      ? {
          baseMs: Math.max(0, c.baseMs),
          since: typeof c.since === "number" && Number.isFinite(c.since) ? c.since : null,
        }
      : null;
  const attendees = pos(r.attendees, 500);
  return {
    attendees: attendees === null ? null : Math.round(attendees),
    hourlyRate: pos(r.hourlyRate, 100_000),
    currency: text(r.currency, 8),
    clock,
  };
}

export const useCostTicker = create<CostTicker>()(
  persist((): CostTicker => ({ ...COST_INITIAL }), {
    name: COST_KEY,
    storage: createJSONStorage(() => sessionStorage),
    skipHydration: true,
    merge: (persisted, current) => ({ ...current, ...normalizeCost(persisted) }),
  })
);

export function hydrateCostTicker(): void {
  if (!useCostTicker.persist.hasHydrated()) void useCostTicker.persist.rehydrate();
}
