"use client";

import { useCallback, useSyncExternalStore } from "react";

/** The query's list, or null where it can't be read (the server, or no matchMedia). */
function mediaList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/** The server can't read a media query, so it renders as if none matches. */
const serverSnapshot = () => false;

/**
 * Whether a media query matches, kept up to date.
 *
 * False on the server and during hydration, so the first client render
 * matches the server's HTML; React re-renders with the real value straight
 * after. Reading `matchMedia` in a state initialiser instead made the
 * hydration render differ whenever the query matched (reduced motion, phone
 * width), which threw React #418/#423 and sent the whole page into a client
 * render. A component that mounts after hydration (a dialog, a client-side
 * navigation) still gets the real value on its first render, so it never
 * flashes the wrong variant (BUG-W31).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = mediaList(query);
      if (!mql) return () => {};
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      // R8: Safari < 14 has no `addEventListener` on MediaQueryList (it
      // throws). Fall back to the legacy `addListener` / `removeListener`.
      const legacy = mql as MediaQueryList & {
        addListener?: (h: () => void) => void;
        removeListener?: (h: () => void) => void;
      };
      legacy.addListener?.(onChange);
      return () => legacy.removeListener?.(onChange);
    },
    [query]
  );
  const getSnapshot = useCallback(() => mediaList(query)?.matches === true, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

export const useIsMobile = () => useMediaQuery("(max-width: 767px)");
export const useIsTouch = () => useMediaQuery("(hover: none)");
/**
 * The person's "reduce motion" setting. Use this rather than framer-motion's
 * `useReducedMotion`, which reads the setting during the first client render
 * (the server can't), so the two renders differ for anyone with it on.
 */
export const usePrefersReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
