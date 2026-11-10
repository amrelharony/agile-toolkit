/**
 * Is it quiet right now on this route? The quiet state (quiet-state.ts) read
 * with the user's stored preferences, as the notification layer reads it
 * (notify.ts readPolicyContext), except that the caller says which route.
 *
 * Pass usePathname()'s value. During a client navigation it already names
 * the new page, while window.location and the notify layer's own copy (set
 * in an effect) can still name the old one: a chart on a ceremony page would
 * otherwise decide it may move. Only null falls back to window.location.
 * Always false on the server, where there is no screen to keep still.
 */

import { getNotificationPrefsSnapshot } from "@/lib/stores/notification-prefs-store";
import { defaultQuietDom, getQuietState } from "./quiet-state";

export function isQuietNow(pathname: string | null): boolean {
  if (typeof window === "undefined") return false;
  const route = pathname === null ? window.location.pathname : pathname;
  return getQuietState(Date.now(), route, defaultQuietDom(), getNotificationPrefsSnapshot()).quiet;
}
