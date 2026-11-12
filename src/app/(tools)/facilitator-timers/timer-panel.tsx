"use client";

import type { RefObject } from "react";
import { Check, Coffee, MonitorPlay, Pause, Play, SkipForward, Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import {
  clockTime,
  currentStep,
  lengthText,
  stepsSeconds,
  type TimerRun,
} from "@/lib/facilitator-timers/model";
import { formatClock, type DockedTimer } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";

/** "+1:05" over a break's return time. */
function overText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The timer that's on: the step's countdown in large type (a break shows
 * the time to be back, and counts up once it has passed), the steps done,
 * now and next, and the controls. The docked timer is its clock, so it
 * keeps counting on other pages.
 */
export function TimerPanel({
  run,
  dock,
  remaining,
  now,
  big,
  controlsRef,
  onPause,
  onResume,
  onNext,
  onStop,
  onPresent,
}: {
  run: TimerRun;
  /** The dock's countdown for the step; null once the run is finished. */
  dock: DockedTimer | null;
  remaining: number;
  now: number;
  /** Presenting: the timer fills the screen. */
  big: boolean;
  controlsRef?: RefObject<HTMLButtonElement>;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
  onStop: () => void;
  onPresent: () => void;
}) {
  const step = currentStep(run);
  const running = Boolean(dock && dock.endsAt !== null && remaining > 0);
  const done = remaining <= 0;
  const last = run.index >= run.steps.length - 1;
  const isBreak = run.kind === "break";
  const next = run.steps[run.index + 1];

  const controls = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {!run.finished && !done && (
        <Button
          ref={controlsRef}
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={running ? onPause : onResume}
        >
          {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {running ? "Pause" : "Resume"}
        </Button>
      )}
      {!run.finished && !isBreak && (
        <Button
          ref={done ? controlsRef : undefined}
          type="button"
          variant={done ? "default" : "ghost"}
          className="gap-1.5"
          onClick={onNext}
        >
          {last ? <Check aria-hidden="true" /> : <SkipForward aria-hidden="true" />}
          {last ? "Finish" : done && next ? `Start ${next.label.toLowerCase()}` : "Next step"}
        </Button>
      )}
      <Button
        ref={run.finished || (isBreak && done) ? controlsRef : undefined}
        type="button"
        variant="ghost"
        className="gap-1.5"
        onClick={onStop}
      >
        <Square aria-hidden="true" />
        {run.finished ? "Close" : isBreak ? "End break" : "Stop"}
      </Button>
      {!big && (
        <Button type="button" variant="ghost" className="gap-1.5" onClick={onPresent}>
          <MonitorPlay aria-hidden="true" />
          Show on the big screen
        </Button>
      )}
    </div>
  );

  if (isBreak && run.backAt !== undefined) {
    const over = Math.max(0, (now - run.backAt) / 1000);
    return (
      <SectionCard title="Break" icon={Coffee} titleSize="sm">
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <p
            className={cn(
              "font-display text-text",
              big ? "text-5xl sm:text-7xl" : "text-3xl sm:text-4xl"
            )}
          >
            Back at {clockTime(run.backAt)}
          </p>
          <span
            role="timer"
            aria-label={
              done
                ? `Break: time's up, ${overText(over)} over`
                : `Break: ${formatClock(remaining)} left`
            }
            className={cn(
              "font-data font-bold tabular-nums",
              big ? "text-6xl sm:text-8xl" : "text-5xl",
              done ? "text-warning" : "text-text"
            )}
          >
            {done ? overText(over) : formatClock(remaining)}
          </span>
          <p className="text-sm text-sub" role="status">
            {done
              ? "Time's up: welcome back."
              : "Enjoy the break. The clock keeps going on other pages."}
          </p>
          {controls}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={run.title} icon={Timer} titleSize="sm">
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        {run.finished || !step ? (
          <p className="text-base text-text" role="status">
            {run.title} done: all {run.steps.length} steps ({lengthText(stepsSeconds(run.steps))}).
          </p>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-sub">
              Step {run.index + 1} of {run.steps.length}
            </p>
            <p className={cn("font-display text-text", big ? "text-4xl sm:text-6xl" : "text-2xl")}>
              {step.label}
            </p>
            <span
              role="timer"
              aria-label={`${step.label}: ${done ? "time's up" : `${formatClock(remaining)} left`}`}
              className={cn(
                "font-data font-bold tabular-nums",
                big ? "text-6xl sm:text-8xl" : "text-5xl",
                done ? "text-warning" : "text-text"
              )}
            >
              {done ? "Time's up" : formatClock(remaining)}
            </span>
            {next && (
              <p className="text-sm text-sub">
                Next: {next.label}, {lengthText(next.seconds)}
              </p>
            )}
          </>
        )}
        {controls}
      </div>
      {!big && (
        <ol className="mt-4 space-y-1 border-t border-border pt-3" aria-label="Steps">
          {run.steps.map((s, i) => {
            const state = run.finished || i < run.index ? "done" : i === run.index ? "now" : "next";
            return (
              <li
                key={s.id}
                aria-current={state === "now" ? "step" : undefined}
                className={cn(
                  "flex items-baseline justify-between gap-3 rounded px-2 py-1 text-sm",
                  state === "now" && "bg-accent/10 font-medium text-text",
                  state === "done" && "text-sub line-through",
                  state === "next" && "text-sub"
                )}
              >
                <span className="min-w-0">
                  {state === "done" && <span className="sr-only">Done: </span>}
                  {s.label}
                </span>
                <span className="shrink-0 font-data text-xs">{lengthText(s.seconds)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
