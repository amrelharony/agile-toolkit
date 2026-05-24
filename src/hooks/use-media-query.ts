"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe media-query hook. Returns false on the server; on the client,
 * uses a lazy initializer so the FIRST render already reflects the real
 * match — without this, components like `useIsMobile()` flash the
 * desktop variant for one frame on every mobile load. (BUG-W31)
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // R8: Safari < 14 doesn't support `addEventListener` on
    // MediaQueryList — it throws `TypeError: undefined is not a
    // function`. Feature-detect and fall back to the legacy
    // `addListener` / `removeListener` API.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    // Legacy Safari path.
    const legacy = mql as MediaQueryList & {
      addListener?: (h: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (h: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(handler);
    return () => legacy.removeListener?.(handler);
  }, [query]);

  return matches;
}

export const useIsMobile = () => useMediaQuery("(max-width: 767px)");
export const useIsTouch = () => useMediaQuery("(hover: none)");
export const usePrefersReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
