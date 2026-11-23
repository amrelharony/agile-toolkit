"use client";

import type { TestSession } from "@/lib/stores/workspace-types";
import { sessionEndsAt } from "@/lib/test-sessions/model";
import { claimDock, countdown, useDockTimer, type DockedTimer } from "@/lib/timer/dock-timer";

/**
 * A running session's clock, on the app's docked timer, so it keeps counting
 * while the tester works in the product or another tool. The shell's pill
 * shows it on every other page and, at zero, says time's up and rings the
 * shared alarm on every page, this one included (as on Icebreaker): the page
 * neither rings nor registers its own, so nothing rings twice.
 *
 * The href has no query: the pill hides only on the page whose pathname is
 * the timer's href, and a pathname never has one. The open session is found
 * from its running status, not from the URL.
 *
 * Another page's timer is never replaced: the page says who holds it.
 */

/** The page that owns a test session's docked timer. */
export const TEST_SESSIONS_HREF = "/test-sessions";

/** The docked timer's label for a session. */
export const timerLabel = (session: Pick<TestSession, "charter">) =>
  `Test session: ${session.charter.target}`;

/** The docked timer when this page holds it, else null. */
export function ownDock(timer: DockedTimer | null): DockedTimer | null {
  return timer?.href === TEST_SESSIONS_HREF ? timer : null;
}

/** The docked timer when another page holds it, else null. */
export function otherDock(timer: DockedTimer | null): DockedTimer | null {
  return timer && timer.href !== TEST_SESSIONS_HREF ? timer : null;
}

/** Put `seconds` of a session's time on the dock, running from `now`, unless another page holds it. */
export function claimSessionTimer(
  session: Pick<TestSession, "charter">,
  seconds: number,
  now: number = Date.now()
): { ok: true } | { ok: false; holder: DockedTimer } {
  const clock = countdown(timerLabel(session), TEST_SESSIONS_HREF, seconds);
  return claimDock({ ...clock, endsAt: now + clock.totalSeconds * 1000 });
}

/** Start a session's whole length on the dock. */
export const startSessionTimer = (
  session: Pick<TestSession, "charter" | "minutes">,
  now?: number
) => claimSessionTimer(session, session.minutes * 60, now);

/** The time a started session has left, in whole seconds (0 once it is up). */
export function secondsLeft(
  session: Pick<TestSession, "startedAt" | "minutes">,
  now: number = Date.now()
): number {
  const end = sessionEndsAt(session);
  return end === null ? session.minutes * 60 : Math.max(0, Math.ceil((end - now) / 1000));
}

/** Stop this page's docked timer; another page's is left alone. */
export function stopSessionTimer(): void {
  const dock = useDockTimer.getState();
  if (dock.timer?.href === TEST_SESSIONS_HREF) dock.stop();
}

/** "The Standup timer is running: stop it first." */
export const dockBusyText = (holder: DockedTimer) =>
  `The ${holder.label} timer is running: stop it first.`;
