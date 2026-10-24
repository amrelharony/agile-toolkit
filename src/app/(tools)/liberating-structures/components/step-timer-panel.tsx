"use client";

import { useEffect, useState } from "react";
import { Check, Pause, Play, SkipForward, Square, Timer } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { formatClock, timerRemaining, type DockedTimer } from "@/lib/timer/dock-timer";
import { currentStep, runSeconds, type StepRun } from "@/lib/timer/step-timer";
import { durationText } from "@/app/(tools)/ceremony-timer/agenda";
import { cn } from "@/lib/utils";

/**
 * The run of a structure's steps: the current step's clock (the docked
 * timer, which the shell hides on this page), what happens in it, and the
 * whole sequence with done, now and next. The shell's DockedTimer still
 * runs here: it stops the clock at 0:00 and announces "time's up".
 */
export function StepTimerPanel({
  run,
  timer,
  onPause,
  onResume,
  onNext,
  onStop,
}: {
  run: StepRun;
  /** The dock's countdown for the current step; null once the run is finished. */
  timer: DockedTimer | null;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
  onStop: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(timer && timer.endsAt !== null);
  useVisibilityTick(running, 1000, () => setNow(Date.now()));
  // A pause, resume or new step shows at once, not on the next tick.
  useEffect(() => setNow(Date.now()), [timer]);

  const step = currentStep(run);
  const remaining = timer ? timerRemaining(timer, now) : 0;
  const done = remaining === 0;
  const last = run.index === run.steps.length - 1;

  return (
    <SectionCard title={`Step timer: ${run.title}`} icon={Timer}>
      {run.finished || !step ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-text" role="status">
            All {run.steps.length} steps done ({durationText(runSeconds(run))} planned).
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onStop}>
            Close
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-sub">
              Step {run.index + 1} of {run.steps.length}
            </p>
            <p className="text-base font-semibold text-text">{step.label}</p>
            {step.hint && <p className="text-sm text-sub">{step.hint}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span
              role="timer"
              aria-label={`${step.label}: ${done ? "time's up" : `${formatClock(remaining)} left`}`}
              className={cn(
                "font-mono text-3xl font-bold tabular-nums",
                done ? "text-warning" : "text-text"
              )}
            >
              {done ? "Time's up" : formatClock(remaining)}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {timer && !done && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={running ? onPause : onResume}
                >
                  {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  {running ? "Pause" : "Resume"}
                </Button>
              )}
              <Button type="button" size="sm" className="gap-1" onClick={onNext}>
                {last ? <Check aria-hidden="true" /> : <SkipForward aria-hidden="true" />}
                {last ? "Finish" : "Next step"}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={onStop}>
                <Square aria-hidden="true" />
                Stop
              </Button>
            </span>
          </div>
        </div>
      )}

      <ol className="mt-4 space-y-1 border-t border-border pt-3" aria-label="Steps">
        {run.steps.map((s, i) => {
          const state = run.finished || i < run.index ? "done" : i === run.index ? "now" : "next";
          return (
            <li
              key={s.id}
              aria-current={state === "now" ? "step" : undefined}
              className={cn(
                "flex items-baseline justify-between gap-3 rounded px-2 py-1 text-sm",
                state === "now" && "bg-accent/10 text-text font-medium",
                state === "done" && "text-sub line-through",
                state === "next" && "text-sub"
              )}
            >
              <span className="min-w-0">
                {state === "done" && <span className="sr-only">Done: </span>}
                {s.label}
              </span>
              <span className="shrink-0 font-mono text-xs">{durationText(s.seconds)}</span>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
