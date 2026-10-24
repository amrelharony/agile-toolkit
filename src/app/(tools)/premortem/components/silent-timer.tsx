"use client";

import { useState } from "react";
import { Pause, Play, Square, Timer } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
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
import { PREMORTEM_PATH } from "../model";

export const SILENT_TIMER_LABEL = "Premortem · silent writing";

/** The writing times on offer. The facilitator picks one; nothing starts on its own. */
export const SILENT_MINUTES = [3, 5, 10] as const;

/** The timer this page puts on the dock, running from `now`. */
export function silentTimer(minutes: number, now: number = Date.now()) {
  const t = countdown(SILENT_TIMER_LABEL, PREMORTEM_PATH, minutes * 60);
  return { ...t, endsAt: now + t.totalSeconds * 1000 };
}

/**
 * The silent-writing clock. It runs on the app's docked timer, so it keeps
 * going while the facilitator opens another tool; the dock hides its pill
 * on the page that owns it, so the clock shows here instead. A timer
 * another page holds (a ceremony's) is never replaced: the page says so.
 *
 * `startable={false}` shows only a running clock, for the page outside the
 * Write phase: a clock started there keeps going when the facilitator opens
 * another premortem (or deletes this one), and the dock shows no pill on
 * this page, so the controls have to stay somewhere.
 */
export function SilentTimer({
  startable = true,
  className,
}: {
  startable?: boolean;
  className?: string;
}) {
  const announce = useAnnounce();
  const dock = useDockTimer((s) => s.timer);
  const mine = dockOwnedBy(PREMORTEM_PATH, dock);
  const [now, setNow] = useState(() => Date.now());
  const [blocked, setBlocked] = useState<string | null>(null);
  const running = Boolean(mine && mine.endsAt !== null);
  useVisibilityTick(running, 1000, () => setNow(Date.now()));

  const start = (minutes: number) => {
    const claim = claimDock(silentTimer(minutes));
    if (!claim.ok) {
      const msg = `The “${claim.holder.label}” timer is on the dock. Stop it there first.`;
      setBlocked(msg);
      announce(msg);
      return;
    }
    setBlocked(null);
    setNow(Date.now());
    announce(`Silent writing: ${minutes} minutes, started.`);
  };

  if (!mine) {
    if (!startable) return null;
    return (
      <div className="flex flex-col gap-1.5">
        <div
          role="group"
          aria-label="Silent writing timer"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="inline-flex items-center gap-1.5 text-sm text-sub">
            <Timer className="h-4 w-4 text-accent" aria-hidden="true" />
            Silent writing:
          </span>
          {SILENT_MINUTES.map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => start(m)}
              aria-label={`Start a ${m}-minute silent writing timer`}
            >
              {m} min
            </Button>
          ))}
        </div>
        {blocked && <p className="text-xs text-warning">{blocked}</p>}
      </div>
    );
  }

  const remaining = timerRemaining(mine, now);
  const done = remaining === 0;
  const { pause, resume, stop } = useDockTimer.getState();
  return (
    <div
      role="group"
      aria-label="Silent writing timer"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
        done ? "border-warning/50 bg-warning/10" : "border-border bg-surface",
        className
      )}
    >
      <Timer className={cn("h-4 w-4", done ? "text-warning" : "text-accent")} aria-hidden="true" />
      <span className="text-sm text-text">Silent writing</span>
      {/* No live region: a clock read out every second drowns everything else.
          The dock announces "time's up" once. */}
      <span
        role="timer"
        className={cn("font-mono text-lg tabular-nums", done ? "text-warning" : "text-text")}
      >
        {done ? "Time's up" : formatClock(remaining)}
      </span>
      <span className="ml-auto flex items-center gap-1">
        {!done && (
          <IconButton
            label={running ? "Pause the silent writing timer" : "Resume the silent writing timer"}
            icon={running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            onClick={() => {
              if (running) {
                pause();
                announce("Silent writing timer paused.");
              } else {
                resume();
                setNow(Date.now());
                announce("Silent writing timer resumed.");
              }
            }}
          />
        )}
        <IconButton
          label="Stop the silent writing timer"
          icon={<Square aria-hidden="true" />}
          onClick={() => {
            stop();
            announce("Silent writing timer stopped.");
          }}
        />
      </span>
    </div>
  );
}
