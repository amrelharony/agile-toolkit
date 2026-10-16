"use client";

/**
 * Retro timebox widget — mm:ss readout with preset buttons, start/pause, and
 * reset. Stateless: the parent owns the countdown (the Board's interval).
 */

import { Timer } from "lucide-react";
import { formatTimer } from "../helpers";

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
  const PRESETS = [300, 600, 900, 1800];

  return (
    <div className="flex items-center gap-2 text-sm">
      <Timer className="w-4 h-4 text-sub" />
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
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => {
              onChange(p);
            }}
            className="text-xs px-1.5 py-0.5 rounded border border-border text-sub hover:border-accent-cyan/40 hover:text-accent transition-colors"
          >
            {p / 60}m
          </button>
        ))}
      </div>
      <button
        onClick={onToggle}
        className="text-xs px-2 py-0.5 rounded border border-border text-sub hover:border-accent-cyan/50 hover:text-accent transition-colors"
      >
        {running ? "Pause" : "Start"}
      </button>
      <button
        onClick={onReset}
        className="text-xs px-2 py-0.5 rounded border border-border text-sub hover:border-border transition-colors"
      >
        Reset
      </button>
    </div>
  );
}
