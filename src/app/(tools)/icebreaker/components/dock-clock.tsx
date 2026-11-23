"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { DockOvertime } from "@/components/timer/dock-overtime";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import {
  formatClock,
  timerRemaining,
  useDockTimer,
  type DockedTimer,
} from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";

/**
 * The docked timer's clock on the page that owns it (the shell hides its
 * pill there). Pause and resume act on the dock, so the pill on the next
 * page shows the same time; "time's up" is announced and rung by the
 * shell's DockedTimer, which runs on this page too, and the overtime counts
 * up here.
 */
export function DockClock({
  timer,
  onStop,
  size = "lg",
  controlRef,
}: {
  timer: DockedTimer;
  onStop: () => void;
  size?: "lg" | "sm";
  /**
   * Its first control (Pause, or Close once time is up), where focus goes
   * when Start swaps itself for this clock.
   */
  controlRef?: (el: HTMLElement | null) => void;
}) {
  const announce = useAnnounce();
  const [now, setNow] = useState(() => Date.now());
  const running = timer.endsAt !== null;
  useVisibilityTick(running, 1000, () => setNow(Date.now()));
  // A pause, resume or new countdown shows at once, not on the next tick.
  useEffect(() => setNow(Date.now()), [timer]);

  const remaining = timerRemaining(timer, now);
  const done = remaining === 0;
  const { pause, resume } = useDockTimer.getState();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        role="timer"
        aria-label={`${timer.label}: ${done ? "time's up" : `${formatClock(remaining)} left`}`}
        className={cn(
          "font-mono tabular-nums",
          size === "lg" ? "text-3xl font-bold" : "text-base",
          done ? "text-warning" : "text-text"
        )}
      >
        {done ? "Time's up" : formatClock(remaining)}
        {done && (
          <DockOvertime
            timer={timer}
            className={cn("ml-2 font-semibold", size === "lg" ? "text-base" : "text-sm")}
          />
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {!done && (
          <Button
            ref={controlRef}
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => {
              if (running) {
                pause();
                announce(`${timer.label} timer paused`);
              } else {
                resume();
                announce(`${timer.label} timer resumed`);
              }
            }}
          >
            {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {running ? "Pause" : "Resume"}
          </Button>
        )}
        <Button
          ref={done ? controlRef : undefined}
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1"
          onClick={onStop}
        >
          <Square aria-hidden="true" />
          {done ? "Close timer" : "Stop timer"}
        </Button>
      </span>
    </div>
  );
}
