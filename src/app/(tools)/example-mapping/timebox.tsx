"use client";

import { useState } from "react";
import { Pause, Play, Square, Timer } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { DockOvertime } from "@/components/timer/dock-overtime";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import {
  claimDock,
  countdown,
  dockOwnedBy,
  formatClock,
  timerRemaining,
  useDockTimer,
} from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";

/** The timer a page puts on the dock: `minutes` from `now`, running. */
export function timeboxTimer(label: string, href: string, minutes: number, now = Date.now()) {
  const t = countdown(label, href, minutes * 60);
  return { ...t, endsAt: now + t.totalSeconds * 1000 };
}

/**
 * A page's timebox on the app's docked timer, so it keeps running while the
 * facilitator opens another tool (the dock shows no pill on the page that
 * owns it, so the clock shows here). The shared alarm rings at zero. A
 * timer another page holds is never replaced: the page says whose it is.
 * Example Mapping and Relative Sizing both use it.
 */
export function DockTimebox({
  label,
  href,
  minutes,
  what,
  onStart,
  className,
}: {
  /** The dock's label: "Example Mapping · Pay with a saved card". */
  label: string;
  /** The page that owns it. */
  href: string;
  minutes: number;
  /** What is timed, in a sentence's middle: "the map". */
  what: string;
  onStart?: () => void;
  className?: string;
}) {
  const announce = useAnnounce();
  const dock = useDockTimer((s) => s.timer);
  const mine = dockOwnedBy(href, dock);
  const [now, setNow] = useState(() => Date.now());
  const [blocked, setBlocked] = useState<string | null>(null);
  const running = Boolean(mine && mine.endsAt !== null);
  useVisibilityTick(running, 1000, () => setNow(Date.now()));

  const start = () => {
    const claim = claimDock(timeboxTimer(label, href, minutes));
    if (!claim.ok) {
      const msg = `The “${claim.holder.label}” timer is running. Stop it first to time ${what}.`;
      setBlocked(msg);
      announce(msg);
      return;
    }
    setBlocked(null);
    setNow(Date.now());
    announce(`Timebox started: ${minutes} minutes.`);
    onStart?.();
  };

  if (!mine) {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={start}>
          <Timer aria-hidden="true" />
          Start the {minutes}-minute timebox
        </Button>
        {blocked && (
          <p role="status" className="text-xs text-warning">
            {blocked}
          </p>
        )}
      </div>
    );
  }

  const remaining = timerRemaining(mine, now);
  const done = remaining === 0;
  const { pause, resume, stop } = useDockTimer.getState();
  return (
    <div
      role="group"
      aria-label="Timebox"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
        done ? "border-warning/50 bg-warning/10" : "border-border bg-surface",
        className
      )}
    >
      <Timer className={cn("h-4 w-4", done ? "text-warning" : "text-accent")} aria-hidden="true" />
      <span className="text-sm text-text">Timebox</span>
      {/* No live region: a clock read out every second drowns everything else.
          The dock announces "time's up" once and rings the shared alarm. */}
      <span
        role="timer"
        className={cn("font-mono text-lg tabular-nums", done ? "text-warning" : "text-text")}
      >
        {done ? "Time's up" : formatClock(remaining)}
        {done && <DockOvertime timer={mine} className="ml-2 text-sm font-semibold" />}
      </span>
      <span className="ml-auto flex items-center gap-1">
        {!done && (
          <IconButton
            label={running ? "Pause the timebox" : "Resume the timebox"}
            icon={running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            onClick={() => {
              if (running) {
                pause();
                announce("Timebox paused.");
              } else {
                resume();
                setNow(Date.now());
                announce("Timebox resumed.");
              }
            }}
          />
        )}
        <IconButton
          label="Stop the timebox"
          icon={<Square aria-hidden="true" />}
          onClick={() => {
            stop();
            announce("Timebox stopped.");
          }}
        />
      </span>
    </div>
  );
}
