"use client";

import { useEffect, useRef } from "react";

/**
 * Run `onTick` on a setInterval — but pause when the tab is hidden,
 * resume when it becomes visible again, and fire one catch-up call the
 * instant visibility returns.
 *
 * Why this hook exists: every wall-clock countdown in the toolkit
 * (canvas in-board timer, standalone ceremony timer, future per-tool
 * sprint countdowns) needs the same three rules:
 *
 *   1. setInterval is throttled to ≥1 s (often ≥60 s) when the tab is
 *      hidden — leaving it running burns CPU AND fires fewer ticks than
 *      expected, so the countdown drifts past wall time.
 *   2. Stopping the interval on hide saves CPU but means we miss the
 *      moment the user returns. Firing once on visibilitychange→visible
 *      bridges the gap so the display catches up immediately.
 *   3. The two timer implementations had the same boilerplate
 *      (visibilitychange listener + ref-tracked interval handle); a
 *      single hook lets future timer-style widgets (poker round timer,
 *      retro break, etc.) opt in with one line.
 *
 * `onTick` is captured via ref so callers can pass an inline arrow
 * function without re-running the effect every render. Only `running`
 * and `intervalMs` actually drive the effect lifecycle.
 *
 * SSR-safe: bails out silently when `document` is undefined.
 */
export function useVisibilityTick(running: boolean, intervalMs: number, onTick: () => void): void {
  const tickRef = useRef(onTick);
  // Refresh the ref on every render so the interval always calls the
  // freshest closure. No dep array — runs every render but does only a
  // single assignment, much cheaper than re-creating the interval.
  useEffect(() => {
    tickRef.current = onTick;
  });

  useEffect(() => {
    if (!running) return;
    if (typeof document === "undefined") return;

    let handle: ReturnType<typeof setInterval> | null = null;
    const tick = () => tickRef.current();
    const start = (): void => {
      if (handle !== null) return;
      handle = setInterval(tick, intervalMs);
    };
    const stop = (): void => {
      if (handle === null) return;
      clearInterval(handle);
      handle = null;
    };
    const onVis = (): void => {
      if (document.visibilityState === "visible") {
        // Catch-up call so the display reflects elapsed wall time
        // immediately, not on the next interval boundary (which may
        // be up to intervalMs away).
        tick();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running, intervalMs]);
}
