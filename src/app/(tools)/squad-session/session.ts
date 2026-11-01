"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { claimDock, useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";
import {
  nextStep,
  startSteps,
  stepDock,
  type StepRun,
  type TimedStep,
} from "@/lib/timer/step-timer";

/**
 * The session's clock: three steps, one docked countdown each, so the time keeps
 * counting while the facilitator opens another tool. Silent: the shell's pill
 * says "time's up" and nothing here makes a sound.
 *
 * The run is kept per tab (sessionStorage, like the dock), so coming back finds
 * it where it was. Another page's timer is never replaced: starting then says
 * who holds the dock instead.
 */

/** The page that owns the session's dock. */
export const SQUAD_SESSION_PATH = "/squad-session";

/** Fifteen minutes in all. */
export const SESSION_STEPS: readonly TimedStep[] = [
  {
    id: "read",
    label: "Read the story",
    seconds: 3 * 60,
    hint: "Read it together, or take turns reading a panel aloud.",
  },
  {
    id: "discuss",
    label: "Discuss its question",
    seconds: 8 * 60,
    hint: "Hear from everyone once before anyone speaks twice.",
  },
  {
    id: "actions",
    label: "Agree actions",
    seconds: 4 * 60,
    hint: "One or two small things the team will really do, each with an owner.",
  },
];

export interface SquadRunState {
  /** The episode being run; null when no run is on. */
  ep: number | null;
  run: StepRun | null;
}

export const SQUAD_RUN_KEY = "agile-toolkit:squad-session:run";

/** A stored run the page can carry on with, or nothing: stored values can hold anything. */
export function normalizeSquadRun(raw: unknown): SquadRunState {
  const empty: SquadRunState = { ep: null, run: null };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const run = r.run as Partial<StepRun> | null | undefined;
  if (typeof r.ep !== "number" || !run || typeof run !== "object") return empty;
  if (!Number.isInteger(run.index) || typeof run.title !== "string") return empty;
  const index = Math.min(Math.max(0, run.index as number), SESSION_STEPS.length - 1);
  return {
    ep: r.ep,
    run: {
      owner: SQUAD_SESSION_PATH,
      title: run.title,
      steps: [...SESSION_STEPS],
      index,
      finished: run.finished === true,
    },
  };
}

export const useSquadRun = create<SquadRunState>()(
  persist((): SquadRunState => ({ ep: null, run: null }), {
    name: SQUAD_RUN_KEY,
    storage: createJSONStorage(() => sessionStorage),
    skipHydration: true,
    merge: (persisted, current) =>
      persisted ? { ...current, ...normalizeSquadRun(persisted) } : current,
  })
);

export type SquadClaim = { ok: true; run: StepRun } | { ok: false; holder: DockedTimer };

/** Start the session from the first step, on the dock from `now`, unless another page holds it. */
export function startSession(ep: number, title: string, now: number = Date.now()): SquadClaim {
  const run = startSteps(SQUAD_SESSION_PATH, title, SESSION_STEPS);
  const claim = claimDock(stepDock(run, now) as DockedTimer);
  if (!claim.ok) return claim;
  useSquadRun.setState({ ep, run });
  return { ok: true, run };
}

/** Move to the next step and start its countdown; past the last one the dock is freed. */
export function advanceSession(now: number = Date.now()): SquadClaim | null {
  const { run } = useSquadRun.getState();
  if (!run || run.finished) return null;
  const next = nextStep(run);
  if (next.finished) {
    releaseDock();
    useSquadRun.setState({ run: next });
    return { ok: true, run: next };
  }
  const claim = claimDock(stepDock(next, now) as DockedTimer);
  if (!claim.ok) return claim;
  useSquadRun.setState({ run: next });
  return { ok: true, run: next };
}

/** End the run and free the dock (another page's timer is left alone). */
export function stopSession(): void {
  releaseDock();
  useSquadRun.setState({ ep: null, run: null });
}

function releaseDock(): void {
  const dock = useDockTimer.getState();
  if (dock.timer?.href === SQUAD_SESSION_PATH) dock.stop();
}

/**
 * Whether a stored run is still on: a run whose dock is no longer this page's was
 * stopped from the pill on another page, so it's over. A finished run has no dock
 * and stays until it is closed.
 */
export function runIsLive(run: StepRun | null, timer: DockedTimer | null): boolean {
  if (!run) return false;
  return run.finished || timer?.href === SQUAD_SESSION_PATH;
}
