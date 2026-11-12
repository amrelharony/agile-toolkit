"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/**
 * The part of the page the visitor can see, as an on-screen keyboard leaves it.
 *
 * Moved out of ui/command.tsx (which imports it back) so code on every page,
 * like Amr's panel, can read the keyboard without importing the command
 * palette, and with it cmdk and Radix Dialog.
 */

/** The visual viewport's height and how far down the page it is panned, px. */
export interface VisibleArea {
  height: number;
  offsetTop: number;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The part of the page the visitor can see, tracked while `active`. An
 * on-screen keyboard on iOS Safari, and on Chrome Android (which resizes only
 * the visual viewport by default), shrinks this but never `100dvh`, so a
 * dialog centred and capped by CSS alone stays half under the keyboard. Null
 * where the browser has no `visualViewport`, so the CSS applies there.
 */
export function useVisibleArea(active: boolean): VisibleArea | null {
  const [area, setArea] = useState<VisibleArea | null>(null);
  // A layout effect, so an opening palette is placed from a fresh reading
  // before it paints, never from where the keyboard was last time.
  useIsomorphicLayoutEffect(() => {
    const vv = active ? window.visualViewport : null;
    if (!vv) return;
    const read = () =>
      setArea((prev) =>
        prev?.height === vv.height && prev.offsetTop === vv.offsetTop
          ? prev
          : { height: vv.height, offsetTop: vv.offsetTop }
      );
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    // Keeps the last reading: a closing palette fades out where it was
    // instead of jumping back to the CSS position mid-animation.
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, [active]);
  return area;
}
