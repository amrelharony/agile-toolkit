"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

/** Which ends of a scroll strip still hide content. */
export interface ScrollEdges {
  /** Content hidden before the start (above, or to the left). */
  before: boolean;
  /** Content hidden past the end (below, or to the right). */
  after: boolean;
}

export type ScrollAxis = "x" | "y";

const NO_EDGES: ScrollEdges = { before: false, after: false };

/** Fade length at a hidden end, in px. */
export const SCROLL_FADE_PX = 24;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Read the scroll edges from an element's scroll metrics. A 1 px slack
 * absorbs sub-pixel rounding, so a strip scrolled to its end reads as
 * "nothing after". */
export function readScrollEdges(el: HTMLElement, axis: ScrollAxis): ScrollEdges {
  const pos = axis === "y" ? el.scrollTop : Math.abs(el.scrollLeft);
  const view = axis === "y" ? el.clientHeight : el.clientWidth;
  const total = axis === "y" ? el.scrollHeight : el.scrollWidth;
  return { before: pos > 1, after: pos + view < total - 1 };
}

/**
 * CSS mask that fades out each end of a scroll strip that still hides
 * content, so a strip with a hidden scrollbar shows it scrolls. Returns
 * undefined when everything is in view (no mask, nothing faded).
 */
export function scrollFadeMask(
  axis: ScrollAxis,
  edges: ScrollEdges,
  fade = SCROLL_FADE_PX
): string | undefined {
  if (!edges.before && !edges.after) return undefined;
  const dir = axis === "y" ? "to bottom" : "to right";
  const start = edges.before ? `transparent 0, black ${fade}px` : "black 0";
  const end = edges.after ? `black calc(100% - ${fade}px), transparent 100%` : "black 100%";
  return `linear-gradient(${dir}, ${start}, ${end})`;
}

/**
 * Applies the fade from `scrollFadeStyle` on touch screens only. A mouse
 * user's desktop keeps today's look (and its scrollbar or wheel); phones
 * and tablets hide the scrollbar, so they get the faded ends.
 */
export const COARSE_SCROLL_FADE =
  "pointer-coarse:[mask-image:var(--scroll-fade)] pointer-coarse:[-webkit-mask-image:var(--scroll-fade)]";

/** Inline style carrying the mask for `COARSE_SCROLL_FADE`. Always set
 * (`none` when nothing is hidden) so the variable never inherits a
 * parent strip's fade. */
export function scrollFadeStyle(mask: string | undefined): CSSProperties {
  return { "--scroll-fade": mask ?? "none" } as CSSProperties;
}

/**
 * Tracks which ends of a scrollable element still hide content. Updates
 * on scroll, when the element resizes, and after every render of the
 * caller (content such as a renamed board or a newly mounted button can
 * change the scroll size without resizing the box).
 */
export function useScrollEdges(ref: RefObject<HTMLElement>, axis: ScrollAxis): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(NO_EDGES);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = readScrollEdges(el, axis);
    setEdges((prev) => (prev.before === next.before && prev.after === next.after ? prev : next));
  }, [ref, axis]);

  // Every render: cheap (three layout reads), and bails out of the
  // state update when nothing changed.
  useIsomorphicLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref, measure]);

  return edges;
}
