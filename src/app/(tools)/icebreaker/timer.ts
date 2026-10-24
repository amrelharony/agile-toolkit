"use client";

import type { IceBreaker } from "@/lib/constants/icebreakers";
import { claimDock, countdown, useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";

/**
 * The warm-up's clock, on the app's docked timer, so it keeps counting
 * while the facilitator opens the retro board. The shell's pill shows it
 * on every other page and says "time's up"; this page shows its own clock.
 *
 * Another page's timer is never replaced: taking the dock from the
 * Ceremony Timer reads as Stop there and pauses the meeting (a dock paused
 * at 0:00 is its overtime, still busy). The page says who holds it instead.
 */

/** The page that owns the icebreaker's docked timer. */
export const ICEBREAKER_HREF = "/icebreaker";

/** The docked timer when another page holds it, else null. */
export function otherDock(timer: DockedTimer | null): DockedTimer | null {
  return timer && timer.href !== ICEBREAKER_HREF ? timer : null;
}

/** Start `ib`'s time-box on the dock, running from `now`, unless another page holds it. */
export function startIcebreakerTimer(
  ib: IceBreaker,
  now: number = Date.now()
): { ok: true } | { ok: false; holder: DockedTimer } {
  const clock = countdown(ib.name, ICEBREAKER_HREF, ib.timeMinutes * 60);
  return claimDock({ ...clock, endsAt: now + clock.totalSeconds * 1000 });
}

/** Stop the icebreaker's docked timer; another page's is left alone. */
export function stopIcebreakerTimer(): void {
  const dock = useDockTimer.getState();
  if (dock.timer?.href === ICEBREAKER_HREF) dock.stop();
}

/**
 * Which activity the dock is timing, given what the session remembers: a
 * running id with no docked clock of ours was stopped from the pill on
 * another page, so it is running no longer.
 */
export function runningIdFor(runningId: string | null, timer: DockedTimer | null): string | null {
  return runningId && timer?.href === ICEBREAKER_HREF ? runningId : null;
}
