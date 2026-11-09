"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { installAttention } from "./attention";
import { flushPending, setNotifyPathname } from "./notify";

/**
 * Wires the notification executor to the page. Mounted once beside
 * <AppToaster/> in app/layout.tsx; renders nothing.
 *
 * - loads the notification prefs (Focus, quiet hours, muted keys)
 * - holds a lease on the passive attention listeners (typing detection)
 * - reports the route, and asks held toasts again when the route changes,
 *   presenting mode or the comics intro ends, the tab comes back, or Focus
 *   and quiet hours are changed in Settings
 *
 * Nothing here polls: the executor's own timer runs only while a toast waits.
 */
export function NotifyProvider() {
  const pathname = usePathname();

  useEffect(() => {
    if (!useNotificationPrefsStore.persist.hasHydrated()) {
      void Promise.resolve(useNotificationPrefsStore.persist.rehydrate()).catch(() => {});
    }
    const release = installAttention();

    // <html data-presenting / data-intro> flips: held toasts may go now.
    const observer =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(() => flushPending());
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-presenting", "data-intro"],
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") flushPending();
    };
    document.addEventListener("visibilitychange", onVisible);

    const unsubscribePrefs = useNotificationPrefsStore.subscribe((s, prev) => {
      if (s.focusUntil !== prev.focusUntil || s.quietHours !== prev.quietHours) flushPending();
    });

    return () => {
      release();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribePrefs();
    };
  }, []);

  useEffect(() => {
    setNotifyPathname(pathname);
    flushPending();
  }, [pathname]);

  return null;
}
