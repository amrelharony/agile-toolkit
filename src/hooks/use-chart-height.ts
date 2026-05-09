"use client";

import { useEffect, useState } from "react";

interface Options {
  /** Floor height in px on tall viewports (desktop). Default 220. */
  min?: number;
  /** Ceiling height in px on tall viewports (desktop). Default 420. */
  max?: number;
  /** Height as a fraction of viewport height (0..1). Default 0.45. */
  vhFactor?: number;
  /**
   * Cap the height to a fraction of the viewport WIDTH on narrow screens.
   * Without this, a 320×640 phone gets a 288 px chart that pushes all
   * controls off-screen. Default 0.7 of width — i.e. on a 320 px phone,
   * the chart is at most 224 px tall, leaving room for the controls
   * above and the data table below.
   */
  vwCap?: number;
  /** Floor height in px on phones (< 640 px). Default 160. */
  mobileMin?: number;
}

/**
 * Returns a responsive chart height in px. Recomputes on resize +
 * orientation change via rAF-debounced listeners. SSR-safe: returns the
 * `max` value before mount so the first paint is at least the desktop
 * size (avoids a layout-shift downsize on hydration).
 *
 * The mobile branch is opinionated: charts on narrow phones tend to be
 * boxy (250 × 250 ish) rather than letterboxed, so we cap by viewport
 * width to keep the aspect ratio reasonable.
 */
export function useChartHeight({
  min = 220,
  max = 420,
  vhFactor = 0.45,
  vwCap = 0.7,
  mobileMin = 160,
}: Options = {}): number {
  const [height, setHeight] = useState(max);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let raf = 0;
    const compute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isMobile = vw < 640;

      // Base: viewport-height-driven sizing.
      let h = Math.round(vh * vhFactor);

      if (isMobile) {
        // On phones, cap by viewport width so the chart stays ~square-ish
        // and doesn't dominate vertical space.
        h = Math.min(h, Math.round(vw * vwCap));
        // Floor at the mobile minimum (lower than desktop `min`) so very
        // small phones still get a useful chart without pushing everything
        // off-screen.
        h = Math.max(mobileMin, h);
        // Don't exceed desktop `max` either.
        h = Math.min(h, max);
      } else {
        h = Math.max(min, Math.min(max, h));
      }

      setHeight(h);
    };

    compute();

    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [min, max, vhFactor, vwCap, mobileMin]);

  return height;
}
