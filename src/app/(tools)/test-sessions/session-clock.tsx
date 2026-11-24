"use client";

import { useEffect, useState } from "react";
import { Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DockOvertime } from "@/components/timer/dock-overtime";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { overtimeText } from "@/lib/celebrate/chime";
import type { TestSession } from "@/lib/stores/workspace-types";
import { sessionEndsAt } from "@/lib/test-sessions/model";
import { formatClock, timerRemaining, useDockTimer } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";
import { ownDock, secondsLeft } from "./timer";

/**
 * A running session's own clock (the shell hides its pill on this page).
 * While this page holds the docked timer it reads the dock, so the pill on
 * the next page shows the same time; otherwise (a new tab, or the pill was
 * stopped) it counts from the session's start and offers "Restart the
 * timer". At zero it shows "Time's up" and the overtime: the docked timer
 * says it and rings, on every page. The example's clock stands still and
 * never touches the dock.
 */
export function SessionClock({
  session,
  example = false,
  onRestart,
  onEnd,
  busyText,
}: {
  session: TestSession;
  example?: boolean;
  onRestart: () => void;
  onEnd: () => void;
  /** Why the timer can't restart (another page holds it). */
  busyText?: string | null;
}) {
  const dock = useDockTimer((s) => s.timer);
  const owned = example ? null : ownDock(dock);
  const [now, setNow] = useState(() => Date.now());
  useVisibilityTick(!example, 1000, () => setNow(Date.now()));
  // A new dock state shows at once, not on the next tick.
  useEffect(() => setNow(Date.now()), [dock]);
  const [stillNow] = useState(() => Date.now());

  const at = example ? stillNow : now;
  const remaining = owned ? timerRemaining(owned, at) : secondsLeft(session, at);
  const up = remaining === 0;
  const end = sessionEndsAt(session);
  const over = up && !owned && end !== null ? Math.floor((at - end) / 1000) : 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span
          role="timer"
          aria-label={`${session.charter.target}: ${up ? "time's up" : `${formatClock(remaining)} left`}`}
          className={cn(
            "font-mono text-3xl font-bold tabular-nums",
            up ? "text-warning" : "text-text"
          )}
        >
          {up ? "Time's up" : formatClock(remaining)}
          {up && owned && <DockOvertime timer={owned} className="ml-2 text-base font-semibold" />}
          {up && !owned && over > 0 && (
            <span className="ml-2 text-base font-semibold">{overtimeText(over)}</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {!example && !owned && !up && (
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={onRestart}>
              <Timer aria-hidden="true" />
              Restart the timer
            </Button>
          )}
          <Button type="button" size="sm" className="gap-1" onClick={onEnd}>
            <Square aria-hidden="true" />
            End session
          </Button>
        </span>
      </div>
      {example ? (
        <p className="text-xs text-sub">
          The example&apos;s clock stands still: it never starts the timer.
        </p>
      ) : !owned && !up ? (
        <p className="text-xs text-sub">
          Counting from when it started. Restart the timer to see it on every page.
        </p>
      ) : null}
      {busyText && (
        <p className="text-sm text-sub" role="status">
          {busyText}
        </p>
      )}
    </div>
  );
}
