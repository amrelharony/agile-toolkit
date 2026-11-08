/**
 * When gamification should stay quiet.
 *
 * XP, levels and achievements keep counting everywhere. Facilitators run
 * ceremonies live in front of their team, often on a shared screen, so
 * nothing celebratory may interrupt there: these routes count as quiet for
 * the notification layer (lib/notify/quiet-state.ts). Celebrations go to the
 * Activity inbox and are never dropped, so there is no throttle any more.
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

export function isQuietRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return QUIET_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
