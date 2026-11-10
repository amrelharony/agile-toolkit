"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pause, Play, Timer, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { formatClock, timerRemaining, useDockTimer } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";

/**
 * The running ceremony timer, docked at the bottom left while you use other
 * tools (a facilitator jumping from the agenda to the retro shouldn't lose
 * the clock). Hidden on the timer's own page. Pause, resume, open the
 * timer, or stop it.
 */
export function DockedTimer() {
  const pathname = usePathname();
  const timer = useDockTimer((s) => s.timer);
  const { pause, resume, stop } = useDockTimer.getState();
  const announce = useAnnounce();
  const [now, setNow] = useState(() => Date.now());
  const announcedEndRef = useRef(false);
  const running = Boolean(timer && timer.endsAt !== null);

  useVisibilityTick(running, 1000, () => setNow(Date.now()));

  const remaining = timer ? timerRemaining(timer, now) : 0;

  // Time's up while docked: stop ticking and say so once.
  useEffect(() => {
    if (!timer) {
      announcedEndRef.current = false;
      return;
    }
    if (timer.endsAt !== null && remaining === 0) {
      useDockTimer.getState().pause();
      if (!announcedEndRef.current) {
        announcedEndRef.current = true;
        announce(`${timer.label}: time's up`, "assertive");
      }
    } else if (remaining > 0) {
      announcedEndRef.current = false;
    }
  }, [timer, remaining, announce]);

  if (!timer || pathname === timer.href) return null;
  const done = remaining === 0;

  return (
    <div
      data-vt-hold="dock-timer"
      className={cn(
        "fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-40 flex items-center gap-1 rounded-full border bg-card/95 py-1 pl-3 pr-1 text-sm shadow-lg backdrop-blur md:left-20",
        done ? "border-warning/50" : "border-border"
      )}
    >
      <Timer
        className={cn("h-4 w-4 shrink-0", done ? "text-warning" : "text-accent")}
        aria-hidden="true"
      />
      <Link
        href={timer.href}
        className="flex items-baseline gap-2 rounded px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={`${timer.label} timer: ${done ? "time's up" : `${formatClock(remaining)} left`}. Open the timer`}
      >
        <span className="max-w-[8rem] truncate font-medium text-text">{timer.label}</span>
        <span
          role="timer"
          className={cn("font-mono tabular-nums", done ? "text-warning" : "text-sub")}
        >
          {done ? "Time's up" : formatClock(remaining)}
        </span>
      </Link>
      {!done && (
        <IconButton
          label={running ? "Pause the timer" : "Resume the timer"}
          icon={running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          onClick={() => (running ? pause() : resume())}
        />
      )}
      <IconButton label="Stop and close the timer" icon={<X aria-hidden="true" />} onClick={stop} />
    </div>
  );
}
