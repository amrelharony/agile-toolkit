/**
 * When gamification should stay quiet.
 *
 * XP, levels and achievements keep counting everywhere; only the toasts are
 * held back. Facilitators run ceremonies live in front of their team, often
 * on a shared screen — a "Level 6!" or "Achievement unlocked" pop-up there
 * interrupts the meeting. Elsewhere, celebrations are throttled so a burst of
 * activity produces one toast, not a stack.
 */

/** Tools that are run live with a team. */
export const QUIET_ROUTE_PREFIXES: readonly string[] = [
  "/retro",
  "/planning-poker",
  "/standup",
  "/async-standup",
  "/ceremony-timer",
  "/sprint-review",
  "/refinement",
  "/premortem",
  "/icebreaker",
  "/liberating-structures",
  "/design-sprint",
  "/incident-commander",
  "/canvas",
];

/** Minimum gap between celebration toasts outside quiet routes. */
export const CELEBRATION_TOAST_GAP_MS = 2 * 60 * 1000;

export function isQuietRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return QUIET_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Whether a celebration toast may show now. `lastShownAt` is the time of the
 * previous celebration toast (0 if none).
 */
export function mayCelebrate(
  pathname: string | null | undefined,
  now: number,
  lastShownAt: number
): boolean {
  if (isQuietRoute(pathname)) return false;
  return now - lastShownAt >= CELEBRATION_TOAST_GAP_MS || lastShownAt === 0;
}
