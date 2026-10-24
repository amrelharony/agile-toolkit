"use client";

/**
 * Retro timebox widget — mm:ss readout with preset buttons, start/pause, and
 * reset. Stateless: the parent owns the countdown (the Board's interval).
 * The preset matching a stopped timer shows as pressed, and the row wraps
 * on a phone instead of pushing the page sideways.
 */

import { Timer } from "lucide-react";
import { formatTimer } from "../helpers";

const PRESETS = [300, 600, 900, 1800];

const BUTTON =
  "min-touch-coarse text-xs rounded border border-border text-sub transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function TimerWidget({
  seconds,
  running,
  onToggle,
  onReset,
  onChange,
}: {
  seconds: number;
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
  onChange: (s: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Timer className="w-4 h-4 text-sub" aria-hidden="true" />
      <span
        className={`font-mono text-base font-bold tabular-nums ${
          running && seconds <= 60
            ? "text-status-red animate-pulse"
            : running
              ? "text-accent"
              : "text-sub"
        }`}
      >
        {formatTimer(seconds)}
      </span>
      <div className="flex gap-1" role="group" aria-label="Timebox">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-pressed={!running && seconds === p}
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
    </div>
  );
}
