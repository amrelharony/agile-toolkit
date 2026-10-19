"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * A ceremony timer that keeps running while you move between tools.
 *
 * The Ceremony Timer publishes its countdown here; the shell shows it as a
 * docked pill on every other page (components/timer/docked-timer), and the
 * Timer page restores it when you come back. Time is anchored to the wall
 * clock (`endsAt`), so it stays right through tab throttling and sleep.
 * Kept per tab (sessionStorage): a reload keeps it, a new tab doesn't.
 */
export interface DockedTimer {
  /** What's being timed, e.g. "Standup". */
  label: string;
  /** The page that owns the timer. */
  href: string;
  totalSeconds: number;
  /** Epoch ms when it ends while running; null while paused. */
  endsAt: number | null;
  /** Seconds left while paused (and at the moment it was published). */
  pausedRemaining: number;
}

interface DockTimerState {
  timer: DockedTimer | null;
  publish: (timer: DockedTimer | null) => void;
  pause: (now?: number) => void;
  resume: (now?: number) => void;
  stop: () => void;
}

/** Whole seconds left, never negative. */
export function timerRemaining(t: DockedTimer, now = Date.now()): number {
  if (t.endsAt === null) return Math.max(0, t.pausedRemaining);
  return Math.max(0, Math.ceil((t.endsAt - now) / 1000));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${sec}`
    : `${String(m).padStart(2, "0")}:${sec}`;
}

export const useDockTimer = create<DockTimerState>()(
  persist(
    (set, get) => ({
      timer: null,
      publish: (timer) => set({ timer }),
      pause: (now = Date.now()) => {
        const t = get().timer;
        if (!t || t.endsAt === null) return;
        set({ timer: { ...t, endsAt: null, pausedRemaining: timerRemaining(t, now) } });
      },
      resume: (now = Date.now()) => {
        const t = get().timer;
        if (!t || t.endsAt !== null || t.pausedRemaining <= 0) return;
        set({ timer: { ...t, endsAt: now + t.pausedRemaining * 1000 } });
      },
      stop: () => set({ timer: null }),
    }),
    {
      name: "agile-toolkit:dock-timer",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ timer: s.timer }),
    }
  )
);
