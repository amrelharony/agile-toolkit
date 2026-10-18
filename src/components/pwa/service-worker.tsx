"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js (offline support for visited pages) in production.
 * NEXT_PUBLIC_DISABLE_SW=1 is the kill switch: it unregisters any worker a
 * previous deploy installed, so a bad worker can be removed with an env
 * change and a redeploy.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NEXT_PUBLIC_DISABLE_SW === "1") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* unsupported or blocked — the site works the same without it */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
