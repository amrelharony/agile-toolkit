"use client";

/**
 * Grows the chat's message box with what is in it (design 1.3 item 8): from
 * its own rows (the finished state without script, DNA-SPEC section 8) up to
 * AUTOSIZE_LINES lines, but never past AUTOSIZE_SHARE of the visible box, so
 * a phone with its keyboard up keeps room for the log. Past the cap the box
 * scrolls; below it, it never shows a scrollbar.
 *
 * The visible box is the screen less the keyboard and the site header: the
 * shell writes its height on the panel as --amr-visible-h, from one animation
 * frame per viewport change, while the panel is open (mascot-assistant
 * usePanelViewport). Outside the panel, or before the first write, it is the
 * window's height.
 *
 * The box is sized again when
 *   - its text changes (typing, a starter or a follow-up filling it,
 *     dictation, a send emptying it), before the browser paints;
 *   - its width changes (the panel enlarged, the phone turned), which
 *     rewraps the text, in the next animation frame;
 *   - the visible box changes (the keyboard coming up or going down): the
 *     panel's style is watched for a new --amr-visible-h, or the window for
 *     a resize outside the panel.
 *
 * Measuring sets the box's height to auto for a moment, which would let the
 * row it sits in shrink and the log above it grow, and a log scrolled to its
 * end would be pulled back from it (a shorter scroll range clamps it). So the
 * row's height is held while the box is measured, and the box's own scroll
 * position is put back after.
 *
 * Runtime-free (React only), but part of the chat, so it lives in chat/,
 * which every-page code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";

/** The most lines the box grows to before it scrolls. */
export const AUTOSIZE_LINES = 6;

/** The most of the visible box's height the message box takes. */
export const AUTOSIZE_SHARE = 0.35;

/** The visible box's height, in px, written on the panel by the shell. */
export const VISIBLE_H_VAR = "--amr-visible-h";

/** The panel's root, which carries VISIBLE_H_VAR (and data-amr-layout, always). */
const PANEL_ROOT = "[data-amr-layout]";

/** The box's measures, in px, for the cap. */
export interface AutosizeMetrics {
  /** One line of text. */
  lineHeight: number;
  /** The box's padding and border, top and bottom together. */
  chrome: number;
  /** The visible box's height. */
  visibleHeight: number;
}

/**
 * The tallest the box grows, border to border: AUTOSIZE_LINES lines or
 * AUTOSIZE_SHARE of the visible box, whichever is less, and never less than
 * one line.
 */
export function autosizeCap({ lineHeight, chrome, visibleHeight }: AutosizeMetrics): number {
  const lines = lineHeight * AUTOSIZE_LINES + chrome;
  return Math.max(lineHeight + chrome, Math.min(lines, visibleHeight * AUTOSIZE_SHARE));
}

/**
 * The box's height, border to border, for text that needs `content` px (its
 * scrollHeight with the box at its own rows, plus its border), and whether it
 * scrolls at that height. Half a pixel of rounding never makes it scroll.
 */
export function autosizeHeight(
  content: number,
  metrics: AutosizeMetrics
): { height: number; scrolls: boolean } {
  const cap = autosizeCap(metrics);
  const floor = metrics.lineHeight + metrics.chrome;
  return { height: Math.max(floor, Math.min(content, cap)), scrolls: content > cap + 0.5 };
}

const px = (value: string | null | undefined): number => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** Sizes `box` for its text now. */
export function fitTextarea(box: HTMLTextAreaElement): void {
  const view = box.ownerDocument.defaultView;
  if (!view || !box.isConnected) return;
  const style = view.getComputedStyle(box);
  const lineHeight = px(style.lineHeight) || (px(style.fontSize) || 16) * 1.5;
  const border = px(style.borderTopWidth) + px(style.borderBottomWidth);
  const chrome = px(style.paddingTop) + px(style.paddingBottom) + border;
  const panel = box.closest<HTMLElement>(PANEL_ROOT);
  const visibleHeight =
    px(panel?.style.getPropertyValue(VISIBLE_H_VAR)) ||
    px(style.getPropertyValue(VISIBLE_H_VAR)) ||
    view.innerHeight;

  // Hold the row while the box is measured at its own rows (see the top).
  const row = box.parentElement;
  const heldRow = row?.style.minHeight ?? "";
  if (row) row.style.minHeight = `${row.offsetHeight}px`;
  const scrollTop = box.scrollTop;
  box.style.height = "auto";
  const { height, scrolls } = autosizeHeight(box.scrollHeight + border, {
    lineHeight,
    chrome,
    visibleHeight,
  });
  // A content-box field's height leaves its padding and border out.
  const set = style.boxSizing === "content-box" ? height - chrome : height;
  box.style.height = `${Math.max(0, set)}px`;
  box.style.overflowY = scrolls ? "auto" : "hidden";
  box.scrollTop = scrollTop;
  if (row) row.style.minHeight = heldRow;
}

/**
 * Keeps the message box in `ref` sized for `value`, its text (see the top).
 * Hands back a call that sizes it now, for a change the value doesn't show.
 */
export function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string): () => void {
  const fit = useCallback(() => {
    if (ref.current) fitTextarea(ref.current);
  }, [ref]);

  // Before the browser paints, so a growing line never shows clipped.
  useLayoutEffect(() => {
    fit();
  }, [fit, value]);

  useEffect(() => {
    const box = ref.current;
    const view = box?.ownerDocument.defaultView;
    if (!box || !view) return;
    let frame = 0;
    const later = () => {
      if (frame) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };

    // Its width: in a frame, since sizing it inside the observer would
    // report a change of its own in the same frame.
    let width = box.clientWidth;
    const resized =
      typeof view.ResizeObserver === "function"
        ? new view.ResizeObserver(() => {
            if (box.clientWidth === width) return;
            width = box.clientWidth;
            later();
          })
        : null;
    resized?.observe(box);

    // The visible box: the panel's variable when it is in one, else the window.
    const panel = box.closest<HTMLElement>(PANEL_ROOT);
    let visible = panel?.style.getPropertyValue(VISIBLE_H_VAR) ?? "";
    const restyled =
      panel && typeof view.MutationObserver === "function"
        ? new view.MutationObserver(() => {
            const next = panel.style.getPropertyValue(VISIBLE_H_VAR);
            if (next === visible) return;
            visible = next;
            fit();
          })
        : null;
    if (panel && restyled)
      restyled.observe(panel, { attributes: true, attributeFilter: ["style"] });
    else view.addEventListener("resize", later);

    return () => {
      resized?.disconnect();
      restyled?.disconnect();
      view.removeEventListener("resize", later);
      if (frame) view.cancelAnimationFrame(frame);
    };
  }, [ref, fit]);

  return fit;
}
