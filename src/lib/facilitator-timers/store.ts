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
 * The browser half: it holds the stores and moves the docked timer (a
 * "use client" module). The settings' shape and cleaning are in
 * ./settings.ts, which the agent's MCP path reads; Amr's actions load this
 * module only when they run in the browser
 * (lib/actions/tools/facilitator-timers.ts).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { claimDock, useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";
import { FT_HREF, nextStep, normalizeRun, stepDock, type CostClock, type TimerRun } from "./model";
import { FT_SETTINGS_INITIAL, normalizeSettings, type FacilitatorSettings } from "./settings";

/* -------------------------------------------------------------------------- */
/*  Settings                                                                   */
/* -------------------------------------------------------------------------- */

export {
  AGENDA_GOAL_MAX,
  DRAFT_HINT_MAX,
  DRAFT_LABEL_MAX,
  DRAFT_MAX_SEGMENTS,
  FT_SETTINGS_INITIAL,
  SETTINGS_KEY,
  normalizeAgendaDraft,
  normalizeDraftSegments,
  normalizeSettings,
  type AgendaDraftState,
  type DraftSegment,
  type FacilitatorSettings,
} from "./settings";

export const useFacilitatorSettings = createPersistedStore<FacilitatorSettings>(
  "facilitator-timers",
  FT_SETTINGS_INITIAL
);

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
  syncBreakBackAt();
}

/**
 * Keep a break's return time with its clock: the docked timer is the
 * break's clock, so a pause and resume (here, or on the pill on another
 * page) moves the time to be back by the length of the pause.
 */
export function syncBreakBackAt(timer: DockedTimer | null = useDockTimer.getState().timer): void {
  const { run } = useFtSession.getState();
  if (!run || run.kind !== "break" || run.finished) return;
  if (timer?.href !== FT_HREF || timer.endsAt === null || run.backAt === timer.endsAt) return;
  useFtSession.setState({ run: { ...run, backAt: timer.endsAt } });
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

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

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
