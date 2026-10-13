"use client";

import { useEffect, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

const EMPTY: ElementSize = { width: 0, height: 0 };

/**
 * Rendered size of `el` (measure an element without padding), debounced (~150 ms) so a window drag or a
 * rotating phone doesn't re-render pages on every frame. The first
 * measurement lands immediately — the reader can't size page 1 without it.
 *
 * Takes the element itself (from a callback ref) rather than a ref object:
 * the reader's frame moves into a portal for the immersive overlay, and the
 * observer has to follow the new element.
 */
export function useElementSize(el: HTMLElement | null, debounceMs = 150): ElementSize {
  const [size, setSize] = useState<ElementSize>(EMPTY);

  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(measure, debounceMs);
    });
    ro.observe(el);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      ro.disconnect();
    };
  }, [el, debounceMs]);

  return size;
}
