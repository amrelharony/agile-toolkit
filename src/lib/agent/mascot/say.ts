"use client";

/**
 * Whether Amr may say something beside himself right now, and saying it.
 *
 * He follows the visitor's own setting for how much celebration they want
 * (Settings › Notifications): on Quiet he says nothing at all, on Balanced only
 * what's useful (a question, an offer of help, a greeting), on Lively the
 * friendly extras too. Never during Focus or the quiet hours, whatever the
 * level. The lines and which level allows which are in lines.ts.
 */

import {
  effectiveCelebrationLevel,
  isFocusActive,
  isWithinQuietHours,
  type NotificationPrefs,
} from "@/lib/notify/prefs";
import { getNotificationPrefsSnapshot } from "@/lib/stores/notification-prefs-store";
import { useBubbleStore, type MascotBubble } from "./bubble";
import { LINES_AT, type LineKind } from "./lines";

export function maySay(
  kind: LineKind,
  prefs: Pick<NotificationPrefs, "celebrationLevel" | "focusUntil" | "quietHours">,
  now: Date
): boolean {
  if (isFocusActive(prefs, now.getTime())) return false;
  if (isWithinQuietHours(prefs.quietHours, now)) return false;
  return LINES_AT[effectiveCelebrationLevel(prefs)].includes(kind);
}

/** Say it, if he may. True when the bubble went up. */
export function say(kind: LineKind, bubble: MascotBubble): boolean {
  if (!maySay(kind, getNotificationPrefsSnapshot(), new Date())) return false;
  useBubbleStore.getState().show(bubble);
  return true;
}
