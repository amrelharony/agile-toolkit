/**
 * Whether the app should stay quiet right now, and why.
 *
 * Quiet means any of: the comics intro is playing, presenting mode is on, a
 * ceremony route is open (a tool run live with a team), Focus is on, or the
 * clock is inside the user's quiet hours. While quiet, nothing celebrates
 * and non-urgent toasts wait; errors and undo still show (see the toast
 * policy). Pure: every input is passed in, so it can be tested as a table.
 */

import { isQuietRoute } from "@/lib/gamification/quiet";
import {
  DEFAULT_NOTIFICATION_PREFS,
  isFocusActive,
  isWithinQuietHours,
  type NotificationPrefs,
} from "./prefs";

/** Why it's quiet, most specific first. */
export type QuietReason = "intro" | "presenting" | "ceremony" | "focus" | "quiet-hours";

export type QuietState = { quiet: false; reason: null } | { quiet: true; reason: QuietReason };

/** What the DOM says: `data-intro` / `data-presenting` on <html>. */
export interface QuietDom {
  dataset: { intro?: string; presenting?: string };
}

/** `document.documentElement`, or null on the server. */
export function defaultQuietDom(): QuietDom | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

const NOT_QUIET: QuietState = { quiet: false, reason: null };

/**
 * @param now      epoch ms or a Date; quiet hours are read in local time
 * @param pathname the current route
 * @param dom      the <html> element (or anything with its dataset)
 * @param prefs    the user's notification preferences (Focus, quiet hours)
 */
export function getQuietState(
  now: number | Date,
  pathname: string | null | undefined,
  dom: QuietDom | null | undefined,
  prefs: Pick<NotificationPrefs, "focusUntil" | "quietHours"> = DEFAULT_NOTIFICATION_PREFS
): QuietState {
  const date = typeof now === "number" ? new Date(now) : now;
  const ms = date.getTime();
  if (dom?.dataset.intro) return { quiet: true, reason: "intro" };
  if (dom?.dataset.presenting === "true") return { quiet: true, reason: "presenting" };
  if (isQuietRoute(pathname)) return { quiet: true, reason: "ceremony" };
  if (isFocusActive(prefs, ms)) return { quiet: true, reason: "focus" };
  if (isWithinQuietHours(prefs.quietHours, date)) return { quiet: true, reason: "quiet-hours" };
  return NOT_QUIET;
}
