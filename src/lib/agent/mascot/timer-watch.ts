/**
 * Time's up, wherever the visitor is: the docked timer (lib/timer/dock-timer)
 * runs out and Amr marks it with the scene of the tool that owns it.
 *
 * It ends one of two ways, and either counts once: the clock reaches `endsAt`
 * with the timer still running, or something pauses it at zero right then (the
 * docked pill does, on its next tick). A timer stopped, replaced or reloaded
 * after it ran out isn't a moment, and neither is one a sleeping tab only
 * notices long after.
 */

import { useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";

/** A finish noticed this late (a throttled or sleeping tab) is too old to mark. */
export const LATE_MS = 5000;

export interface TimerClock {
  now(): number;
  later(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

const realClock: TimerClock = {
  now: () => Date.now(),
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The tool whose page owns the timer: the first segment of its href. */
export function timerTool(timer: Pick<DockedTimer, "href">): string | null {
  return timer.href.split(/[/?#]/)[1] || null;
}

const atZero = (t: DockedTimer | null) => !!t && t.endsAt === null && t.pausedRemaining <= 0;

/** Calls `onFinish(toolId)` each time the docked timer runs out. Returns the unsubscribe. */
export function installTimerWatch(
  onFinish: (toolId: string) => void,
  clock: TimerClock = realClock
): () => void {
  let handle: unknown = null;
  let markedFor: number | null = null;

  const finish = (timer: DockedTimer, endsAt: number) => {
    if (markedFor === endsAt || clock.now() - endsAt > LATE_MS) return;
    markedFor = endsAt;
    const tool = timerTool(timer);
    if (tool) onFinish(tool);
  };

  const arm = (timer: DockedTimer | null) => {
    if (handle !== null) clock.cancel(handle);
    handle = null;
    if (!timer || timer.endsAt === null) return;
    const { endsAt, href } = timer;
    const left = endsAt - clock.now();
    if (left <= 0) return; // ran out before we were watching
    handle = clock.later(() => {
      handle = null;
      const cur = useDockTimer.getState().timer;
      if (cur?.href === href && (cur.endsAt === endsAt || atZero(cur))) finish(cur, endsAt);
    }, left);
  };

  arm(useDockTimer.getState().timer);
  const unsubscribe = useDockTimer.subscribe((s, prev) => {
    if (s.timer === prev.timer) return;
    const was = prev.timer;
    const now = s.timer;
    // Paused at zero just as it ran out.
    if (was?.endsAt != null && now && atZero(now) && now.href === was.href) {
      finish(now, was.endsAt);
    }
    arm(now);
  });

  return () => {
    unsubscribe();
    if (handle !== null) clock.cancel(handle);
    handle = null;
  };
}
