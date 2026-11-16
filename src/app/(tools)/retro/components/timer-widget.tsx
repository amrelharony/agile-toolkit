"use client";

/**
 * Retro timebox widget — mm:ss readout with preset buttons, start/pause, and
 * reset. Stateless: the parent owns the countdown (the Board's interval).
 * The preset matching a stopped timer shows as pressed, and the row wraps
 * on a phone instead of pushing the page sideways.
 *
 * Once the time is up (the Board passes `overSince`, when it rang the shared
 * alarm) it says so and counts the overtime up, until the timer is set or
 * started again. The shared "Chime when time is up" switch sits beside it.
 */

import { useState } from "react";
import { Timer } from "lucide-react";
import { ChimeToggle } from "@/components/timer/chime-toggle";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { overtimeText } from "@/lib/celebrate/chime";
import { formatTimer } from "../helpers";

const PRESETS = [300, 600, 900, 1800];

const BUTTON =
  "min-touch-coarse text-xs rounded border border-border text-sub transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function TimerWidget({
  seconds,
  running,
  overSince = null,
  onToggle,
  onReset,
  onChange,
}: {
  seconds: number;
  running: boolean;
  /** When the timebox ran out (epoch ms), for the overtime; null otherwise. */
  overSince?: number | null;
  onToggle: () => void;
  onReset: () => void;
  onChange: (s: number) => void;
}) {
  const over = overSince !== null && !running && seconds === 0;
  const [now, setNow] = useState(() => Date.now());
  useVisibilityTick(over, 1000, () => setNow(Date.now()));
  const overSeconds = over ? Math.max(0, Math.floor((now - overSince) / 1000)) : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Timer className="w-4 h-4 text-sub" aria-hidden="true" />
      <span
        className={`font-mono text-base font-bold tabular-nums ${
          over
            ? "text-warning"
            : running && seconds <= 60
              ? "text-status-red animate-pulse"
              : running
                ? "text-accent"
                : "text-sub"
        }`}
      >
        {over ? "Time's up" : formatTimer(seconds)}
      </span>
      {over && (
        <span className="text-xs font-semibold text-warning" aria-hidden="true">
          {overtimeText(overSeconds)}
        </span>
      )}
      <div className="flex gap-1" role="group" aria-label="Timebox">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-pressed={!running && seconds === p}
            aria-label={`${p / 60} minutes`}
            title={`${p / 60} minutes`}
            className={`${BUTTON} px-1.5 py-0.5 hover:border-accent-cyan/40 hover:text-accent aria-pressed:border-accent aria-pressed:text-accent`}
          >
            {p / 60}m
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`${BUTTON} px-2 py-0.5 hover:border-accent-cyan/50 hover:text-accent`}
      >
        {running ? "Pause" : "Start"}
      </button>
      <button type="button" onClick={onReset} className={`${BUTTON} px-2 py-0.5`}>
        Reset
      </button>
      <ChimeToggle />
    </div>
  );
}
