"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/**
 * The part of the page the visitor can see, as an on-screen keyboard leaves it.
 *
 * - useVisibleArea: the visual viewport's height and pan, as React state (the
 *   command palette). Moved out of ui/command.tsx, which imports it back, so
 *   code on every page, like Amr's panel, can read the keyboard without
 *   importing the palette, and with it cmdk and Radix Dialog.
 * - readVisibleArea: the keyboard's height and the visible area's edges, as a
 *   pure function of a few numbers (Amr's phone sheet), and measureVisibleArea,
 *   which reads those numbers off the page.
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

/**
 * A keyboard taller than this, px, counts as up. A phone's is 260-340 px; a
 * smaller difference between the viewports is a toolbar's, or rounding.
 */
export const KEYBOARD_UP_PX = 100;

/** Room kept between the visible area and the header, keyboard or screen edge past it, px. */
export const VISIBLE_GAP = 8;

/** Pinch zoom further than this from 1, either way: the visual viewport then follows the zoom. */
const ZOOM_TOLERANCE = 0.01;

/** The fields read off `window.visualViewport`. A stand-in with no `scale` counts as not zoomed. */
export interface ViewportReading {
  height: number;
  offsetTop: number;
  scale?: number;
}

function zoomed(vv: ViewportReading): boolean {
  return Math.abs((vv.scale ?? 1) - 1) > ZOOM_TOLERANCE;
}

/**
 * How much of the layout viewport an on-screen keyboard covers, px: the layout
 * viewport's height less the visual viewport's bottom edge.
 * - iOS Safari, and Chrome Android by default, shrink only the visual viewport,
 *   and iOS pans it down to show the focused field. offsetTop counts that pan,
 *   so the pan is never taken for keyboard.
 * - Firefox Android (and `interactive-widget=resizes-content`) shrink the layout
 *   viewport too: 0, and nothing needs to move, since fixed boxes already stop
 *   above the keyboard.
 * - While pinch-zoomed the visual viewport follows the zoom: 0, rather than a
 *   keyboard as tall as the part zoomed out of view.
 */
export function keyboardHeight(
  clientHeight: number,
  vv: ViewportReading | null | undefined
): number {
  if (!vv || zoomed(vv)) return 0;
  return Math.max(0, clientHeight - vv.offsetTop - vv.height);
}

/** What readVisibleArea works from, px. */
export interface VisibleAreaInput {
  /** The layout viewport's height (documentElement.clientHeight): the keyboard doesn't shrink it. */
  clientHeight: number;
  /** window.visualViewport; null where the browser has none. */
  viewport: ViewportReading | null | undefined;
  /** The site header's bottom edge, from the layout viewport's top (readHeaderBottom); 0 without one. */
  headerBottom: number;
  /** The top safe area (a notch or status bar), env(safe-area-inset-top). */
  safeTop?: number;
  /** The bottom safe area (the home indicator), env(safe-area-inset-bottom). */
  safeBottom?: number;
}

/**
 * The keyboard, and the visible area's edges: `top` from the layout viewport's
 * top, `bottom` (and `restBottom`) from its bottom, as a fixed box's offsets
 * read. What's placed in the area (Amr's phone sheet) sits between them.
 */
export interface VisibleAreaReading {
  /** The keyboard's height over the layout viewport (keyboardHeight): 0 for none, or none that can be told. */
  kb: number;
  /** kb > KEYBOARD_UP_PX: a keyboard, not a toolbar's difference. */
  keyboardUp: boolean;
  /**
   * The top of what can be seen: the visual viewport's top while iOS has
   * panned the page down to a focused field, and never above the top safe
   * area. While pinch-zoomed, the safe area alone (the pan follows the zoom).
   */
  viewTop: number;
  /**
   * The visible area's top edge: under the site header (which sits below any
   * banner above it), or under viewTop once the pan has hidden the header,
   * plus VISIBLE_GAP.
   */
  top: number;
  /** The visible area's bottom edge: above the keyboard, or above the home indicator, plus VISIBLE_GAP. */
  bottom: number;
  /** Where `bottom` is with no keyboard: VISIBLE_GAP above the home indicator. For what stays put while one is up. */
  restBottom: number;
}

/**
 * The keyboard and the visible area, from the numbers measureVisibleArea reads
 * off the page. Pure, so it can be checked at any screen size and keyboard.
 */
export function readVisibleArea(input: VisibleAreaInput): VisibleAreaReading {
  const vv = input.viewport && !zoomed(input.viewport) ? input.viewport : null;
  const kb = keyboardHeight(input.clientHeight, vv);
  const safeTop = Math.max(0, input.safeTop ?? 0);
  const safeBottom = Math.max(0, input.safeBottom ?? 0);
  const viewTop = Math.max(safeTop, vv?.offsetTop ?? 0);
  return {
    kb,
    keyboardUp: kb > KEYBOARD_UP_PX,
    viewTop,
    top: Math.max(input.headerBottom, viewTop) + VISIBLE_GAP,
    // A keyboard covers the home indicator. max(), not a switch on kb > 0, so
    // a sliver of difference between the viewports never puts the edge on it.
    bottom: Math.max(kb, safeBottom) + VISIBLE_GAP,
    restBottom: safeBottom + VISIBLE_GAP,
  };
}

/** Safe-area insets, px. */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_SAFE_AREA: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The style for a probe that readSafeArea reads the safe areas off (fixed,
 * invisible, 0 by 0): env() has no reading of its own in JavaScript, but
 * padding set from it computes to px.
 */
export const SAFE_AREA_PROBE_STYLE = {
  paddingTop: "env(safe-area-inset-top, 0px)",
  paddingRight: "env(safe-area-inset-right, 0px)",
  paddingBottom: "env(safe-area-inset-bottom, 0px)",
  paddingLeft: "env(safe-area-inset-left, 0px)",
} as const;

/** The safe areas, read off a probe styled with SAFE_AREA_PROBE_STYLE. All 0 without one. */
export function readSafeArea(probe: Element | null | undefined): SafeArea {
  if (!probe) return NO_SAFE_AREA;
  const cs = window.getComputedStyle(probe);
  const px = (v: string) => Math.max(0, parseFloat(v) || 0);
  return {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
}

/**
 * The site header's bottom edge, px from the layout viewport's top: measured,
 * since a banner above it, or a page scrolled past it, moves it. 0 without a
 * header, or once it is out of sight above.
 */
export function readHeaderBottom(): number {
  const r = document.querySelector("[data-chrome='header']")?.getBoundingClientRect();
  return Math.max(0, r?.bottom ?? 0);
}

/**
 * readVisibleArea for this page as it is now: the layout and visual viewports,
 * the header's bottom and the safe areas (off `probe`, styled with
 * SAFE_AREA_PROBE_STYLE). Reads layout, so call it from one animation frame,
 * not from every resize event.
 */
export function measureVisibleArea(probe?: Element | null): VisibleAreaReading {
  const safe = readSafeArea(probe);
  return readVisibleArea({
    clientHeight: document.documentElement.clientHeight || window.innerHeight,
    viewport: window.visualViewport,
    headerBottom: readHeaderBottom(),
    safeTop: safe.top,
    safeBottom: safe.bottom,
  });
}
