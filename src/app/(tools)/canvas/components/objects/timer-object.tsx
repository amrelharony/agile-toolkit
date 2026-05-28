"use client";

/**
 * In-canvas timer widget.
 *
 * The data model lives in `WhiteboardTimer` — only `durationSec`,
 * `running`, `startedAt`, `remainingSec`, `label` are stored. Display
 * recomputes the current remaining seconds on every animation frame
 * by subtracting `(now - startedAt) / 1000` from `durationSec`.
 *
 * Play / pause / reset buttons mutate the data model via the supplied
 * onMutate prop; the canvas's diff-sync pipeline broadcasts the
 * change so all peers see synchronised counts.
 */

import { memo, useEffect, useState } from "react";
import { Play, Pause, RotateCcw, Timer as TimerIcon } from "lucide-react";
import type { WhiteboardTimer } from "@/lib/stores/workspace-types";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";

interface TimerObjectProps {
  object: WhiteboardTimer;
  selected: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMutate: (patch: Partial<WhiteboardTimer>) => void;
}

function format(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function TimerObjectImpl({ object: o, selected, onPointerDown, onMutate }: TimerObjectProps) {
  // R11-fix: initial state 0 → real value in useEffect. The previous
  // `useState(() => Date.now())` produced a different timestamp on
  // SSR vs client, triggering a hydration mismatch for every timer
  // widget on initial render. The 0 placeholder renders as "0:00"
  // for one frame, which is acceptable for a timer that's about to
  // show its real remaining time anyway.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
  }, []);
  // R5: pause the tick when the tab is hidden so we don't burn CPU,
  // and catch up the display the moment it becomes visible again.
  // Extracted into useVisibilityTick — same contract as ceremony-timer.
  useVisibilityTick(o.running, 250, () => setNow(Date.now()));

  const remaining =
    o.running && o.startedAt
      ? Math.max(0, o.durationSec - (now - o.startedAt) / 1000)
      : (o.remainingSec ?? o.durationSec);
  const finished = remaining <= 0 && o.running;

  // R5: when the running timer reaches 0, persist running=false ONCE so
  // the next reload doesn't see "running with negative remaining" (the
  // display previously stayed red forever; the data model said running
  // but the math said 0). Fire only when transitioning to finished
  // (running + remaining<=0) to avoid an infinite mutation loop.
  useEffect(() => {
    if (finished) {
      onMutate({ running: false, startedAt: undefined, remainingSec: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const onStart = () => {
    if (o.running) return;
    onMutate({
      running: true,
      startedAt: Date.now() - (o.durationSec - (o.remainingSec ?? o.durationSec)) * 1000,
    });
  };
  const onPause = () => {
    if (!o.running) return;
    onMutate({ running: false, remainingSec: remaining, startedAt: undefined });
  };
  const onReset = () => {
    onMutate({ running: false, startedAt: undefined, remainingSec: o.durationSec });
  };

  return (
    <div
      onPointerDown={onPointerDown}
      data-canvas-object-kind="timer"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
        width: o.w,
        height: o.h,
        background: finished ? "rgba(239, 68, 68, 0.15)" : "#0b0f17",
        border: `2px solid ${selected ? "#00f0ff" : finished ? "#f87171" : "#475569"}`,
        borderRadius: 10,
        boxShadow: selected ? "0 0 12px rgba(0,240,255,0.4)" : "0 1px 3px rgba(0,0,0,0.3)",
        cursor: o.locked ? "default" : "move",
        zIndex: o.z,
        opacity: o.locked ? 0.85 : 1,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
        boxSizing: "border-box",
      }}
    >
      {o.label && (
        <div
          style={{
            fontSize: 11,
            color: "#94a3b8",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            marginBottom: 2,
          }}
        >
          {o.label}
        </div>
      )}
      <div
        style={{
          fontSize: Math.min(36, o.h * 0.45),
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          color: finished ? "#fecaca" : "#e5e7eb",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
        }}
      >
        {format(remaining)}
      </div>
      <div
        style={{ display: "flex", gap: 4, marginTop: 4 }}
        // Stop the buttons' pointer events from starting a drag.
        onPointerDown={(e) => e.stopPropagation()}
      >
        {o.running ? (
          <button
            type="button"
            onClick={onPause}
            aria-label="Pause timer"
            style={{ ...btn, background: "rgba(245,158,11,0.15)", color: "#fcd34d" }}
          >
            <Pause style={{ width: 12, height: 12 }} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            aria-label="Start timer"
            style={{ ...btn, background: "rgba(52,211,153,0.15)", color: "#6ee7b7" }}
          >
            <Play style={{ width: 12, height: 12 }} />
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset timer"
          style={{ ...btn, background: "rgba(148,163,184,0.15)", color: "#cbd5e1" }}
        >
          <RotateCcw style={{ width: 12, height: 12 }} />
        </button>
      </div>
      <div style={{ position: "absolute", top: 4, left: 6, color: "#475569" }}>
        <TimerIcon style={{ width: 10, height: 10 }} />
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export const TimerObject = memo(TimerObjectImpl);
