"use client";

import { useEffect, useRef, useState } from "react";

export type ViewportSize = { w: number; h: number };

/**
 * Owns the viewport DOM ref + cached DOMRect for fast world<->screen
 * coordinate conversion. Re-measures on ResizeObserver and on window
 * scroll (page-level scroll shifts our client-rect.top even though the
 * element itself hasn't resized).
 *
 * The cached DOMRect avoids forcing a layout flush on every pointer
 * move via getBoundingClientRect() — per perf traces in Phase 26 that
 * was costing 1–2 ms per move at 120 Hz pointer rates.
 */
export function useViewportSize(onViewportSize?: (s: ViewportSize) => void) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportRectRef = useRef<DOMRect | null>(null);
  const [size, setSize] = useState<ViewportSize>({ w: 0, h: 0 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      viewportRectRef.current = r;
      const next = { w: r.width, h: r.height };
      setSize(next);
      onViewportSize?.(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Page-level scroll shifts the viewport's client-rect position
    // (rect.top changes) even though the element itself hasn't
    // resized — ResizeObserver alone misses that case. Listen for
    // scroll on the window in passive mode so we don't block native
    // smooth scrolling.
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [onViewportSize]);

  return { viewportRef, viewportRectRef, size };
}
