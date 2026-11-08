"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The stage's viewport height, for BOARD_MAX_H and BOARD_FILL_H: 100dvh
 * (it follows a phone's collapsing address bar) where the browser knows
 * it, 100vh before that (Safari < 15.4, Chrome < 108, Firefox < 101).
 * Without the fallback those browsers would meet 100dvh inside the custom
 * property only at computed-value time, reset the stage's min- and
 * max-height (or its full-screen height) to their initial values, and
 * collapse the board to 0 px: everything in it is absolutely positioned.
 * Put these classes on the element that uses the two heights.
 */
export const BOARD_VH = "[--board-vh:100vh] supports-[height:100dvh]:[--board-vh:100dvh]";

/**
 * The tallest the board stage may be: the visible viewport (BOARD_VH)
 * less the sticky app header, the space a phone keeps for Amr
 * (mascot-assistant's --amr-band-top / -bottom; just the home-indicator
 * safe area where he has none) and a 1 rem gap. So the whole board, zoom
 * controls included, fits on screen once scrolled to, and there is always
 * page above or below it to scroll from.
 */
export const BOARD_MAX_H =
  "calc(var(--board-vh) - var(--header-h) - var(--amr-band-top, 0px) - var(--amr-band-bottom, env(safe-area-inset-bottom, 0px)) - 1rem)";

/**
 * The stage's height while it fills the screen: everything under the app
 * header (and under Amr when he's parked up there on a phone) down to the
 * home-indicator safe area. Amr stands over its bottom-right corner, as he
 * does over the page; the zoom controls sit bottom-left on touch.
 */
export const BOARD_FILL_H =
  "calc(var(--board-vh) - var(--header-h) - var(--amr-band-top, 0px) - env(safe-area-inset-bottom, 0px))";

function cssPx(name: string): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : 0;
}

/**
 * "Board fills the screen" for phones. The stage stays where it is in the
 * page (so nothing remounts and no `position: fixed` has to fight the tool
 * page's transformed wrapper or the sidebar); it grows to BOARD_FILL_H,
 * the page scrolls its top up under the header, and the page stops
 * scrolling until it's switched off. A rotation re-aligns it.
 */
export function useBoardFillScreen(stageRef: RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  const toggle = useCallback(() => setOn((v) => !v), []);

  useIsomorphicLayoutEffect(() => {
    if (!on) return;
    const stage = stageRef.current;
    if (!stage) return;
    const root = document.documentElement;
    const align = () => {
      const top = window.scrollY + stage.getBoundingClientRect().top;
      const target = Math.max(0, top - cssPx("--header-h") - cssPx("--amr-band-top"));
      window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
    };
    align();
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    window.addEventListener("resize", align);
    return () => {
      window.removeEventListener("resize", align);
      root.style.overflow = prevOverflow;
    };
  }, [on, stageRef]);

  return { on, toggle };
}
