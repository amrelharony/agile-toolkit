/**
 * A run of timed steps on the docked timer: a Liberating Structure's
 * steps, Six Hats rounds, any facilitation with a clock per step. Pure: the
 * page keeps the run in its own state and publishes `stepDock(run)` with
 * `claimDock` (lib/timer/dock-timer) when a step starts.
 */

import type { DockedTimer } from "./dock-timer";

export interface TimedStep {
  id: string;
  label: string;
  seconds: number;
  hint?: string;
}

export interface StepRun {
  /** The page that owns the dock while the run is on. */
  owner: string;
  /** What's being run, e.g. "1-2-4-All". */
  title: string;
  steps: TimedStep[];
  /** The step being timed. */
  index: number;
  finished: boolean;
}

export function startSteps(owner: string, title: string, steps: readonly TimedStep[]): StepRun {
  return { owner, title, steps: [...steps], index: 0, finished: steps.length === 0 };
}

export const currentStep = (run: StepRun): TimedStep | undefined =>
  run.finished ? undefined : run.steps[run.index];

/** The run moved on a step; past the last one it is finished. */
export function nextStep(run: StepRun): StepRun {
  if (run.finished) return run;
  const index = run.index + 1;
  return index >= run.steps.length
    ? { ...run, index: run.steps.length - 1, finished: true }
    : { ...run, index };
}

/** The total planned time, in seconds. */
export const runSeconds = (run: Pick<StepRun, "steps">): number =>
  run.steps.reduce((sum, s) => sum + Math.max(0, s.seconds), 0);

/** The dock's countdown for the current step, running from `now`; null when finished. */
export function stepDock(run: StepRun, now: number = Date.now()): DockedTimer | null {
  const step = currentStep(run);
  if (!step) return null;
  const s = Math.max(0, Math.round(step.seconds));
  return {
    label: `${run.title} · ${step.label}`,
    href: run.owner,
    totalSeconds: s,
    endsAt: now + s * 1000,
    pausedRemaining: s,
  };
}
