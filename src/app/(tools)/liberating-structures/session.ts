"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { lsStructure, type LsStructure } from "@/lib/liberating-structures/catalog";
import { claimDock, useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";
import {
  nextStep,
  startSteps,
  stepDock,
  type StepRun,
  type TimedStep,
} from "@/lib/timer/step-timer";

/**
 * The step timer: a structure's steps, one docked countdown each, so
 * "pairs, 2 minutes" keeps counting while the facilitator has the retro
 * board open. The shell's pill shows each step on other pages and says
 * "time's up"; the facilitator moves on with Next step.
 *
 * The run is kept per tab (sessionStorage, like the dock), so leaving the
 * page and coming back finds it where it was. Another page's timer is never
 * replaced: taking the dock from the Ceremony Timer reads as Stop there and
 * pauses the meeting (and a dock paused at 0:00 is its overtime, still
 * busy). Starting then says who holds the dock instead.
 */

/** The page that owns the step timer's dock. */
export const LS_HREF = "/liberating-structures";

export interface LsSession {
  /** The structure being run; null when no run is on. */
  structureId: string | null;
  run: StepRun | null;
}

export const LS_SESSION_KEY = "agile-toolkit:liberating-structures:session";

/** A structure's steps as the step timer runs them; none for a structure without steps. */
export function timedSteps(s: LsStructure): TimedStep[] {
  return (s.steps ?? []).map((step) => ({
    id: step.id,
    label: step.label,
    seconds: Math.max(0, Math.round(step.minutes * 60)),
    hint: step.hint,
  }));
}

/**
 * A stored session the page can carry on with: a known structure and a run
 * of its current steps, or nothing (a stored value can hold anything, and
 * a structure's steps can change between releases).
 */
export function normalizeLsSession(raw: unknown): LsSession {
  const empty: LsSession = { structureId: null, run: null };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const s = lsStructure(typeof r.structureId === "string" ? r.structureId : null);
  const run = r.run as Partial<StepRun> | null | undefined;
  if (!s || !s.steps || !run || typeof run !== "object") return empty;
  const steps = timedSteps(s);
  if (!Number.isInteger(run.index)) return empty;
  const index = Math.min(Math.max(0, run.index as number), steps.length - 1);
  return {
    structureId: s.id,
    run: { owner: LS_HREF, title: s.name, steps, index, finished: run.finished === true },
  };
}

export const useLsSession = create<LsSession>()(
  persist((): LsSession => ({ structureId: null, run: null }), {
    name: LS_SESSION_KEY,
    storage: createJSONStorage(() => sessionStorage),
    skipHydration: true,
    // Nothing stored (a new tab) keeps what's there.
    merge: (persisted, current) =>
      persisted ? { ...current, ...normalizeLsSession(persisted) } : current,
  })
);

export type StepClaim = { ok: true; run: StepRun } | { ok: false; holder: DockedTimer };

/** Start `s`'s steps from the first, on the dock from `now`, unless another page holds it. */
export function startStepTimer(s: LsStructure, now: number = Date.now()): StepClaim | null {
  const steps = timedSteps(s);
  if (steps.length === 0) return null;
  const run = startSteps(LS_HREF, s.name, steps);
  const dock = stepDock(run, now);
  if (!dock) return null;
  const claim = claimDock(dock);
  if (!claim.ok) return claim;
  useLsSession.setState({ structureId: s.id, run });
  return { ok: true, run };
}

/**
 * Move to the next step and start its countdown; past the last step the
 * run is finished and the dock is freed.
 */
export function advanceStepTimer(now: number = Date.now()): StepClaim | null {
  const { run } = useLsSession.getState();
  if (!run || run.finished) return null;
  const next = nextStep(run);
  if (next.finished) {
    releaseDock();
    useLsSession.setState({ run: next });
    return { ok: true, run: next };
  }
  const dock = stepDock(next, now);
  const claim = dock ? claimDock(dock) : null;
  if (claim && !claim.ok) return claim;
  useLsSession.setState({ run: next });
  return { ok: true, run: next };
}

/** End the run and free the dock (another page's timer is left alone). */
export function stopStepTimer(): void {
  releaseDock();
  useLsSession.setState({ structureId: null, run: null });
}

function releaseDock(): void {
  const dock = useDockTimer.getState();
  if (dock.timer?.href === LS_HREF) dock.stop();
}

/**
 * Whether a stored run is still on: a run whose dock is no longer this
 * page's was stopped from the pill on another page (or replaced there by
 * the Ceremony Timer), so it is over. A finished run has no dock and stays
 * until it is closed.
 */
export function runIsLive(run: StepRun | null, timer: DockedTimer | null): boolean {
  if (!run) return false;
  return run.finished || timer?.href === LS_HREF;
}
