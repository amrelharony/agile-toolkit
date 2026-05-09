"use client";

import { useEffect } from "react";
import { getEngine } from "./engine";
import { driftRoot } from "./scales";

/** Module-level so the hook and use-sonification share the same drifted root. */
let currentRoot = driftRoot(0);

export function getCurrentRoot(): number {
  return currentRoot;
}

export function useScrollFilter(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    let rafId = 0;

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const doc = document.documentElement;
        const scrollable = Math.max(1, doc.scrollHeight - window.innerHeight);
        const depth = Math.max(0, Math.min(1, window.scrollY / scrollable));
        getEngine().setScrollFilter01(depth);
        currentRoot = driftRoot(depth);
      });
    };

    // Prime once on mount so the values start in sync.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}
