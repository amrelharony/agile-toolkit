"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Put focus back on a control after an in-place action re-renders the list.
 *
 * Save, Cancel, Delete, Unlink and "Queue for Planning Poker" unmount the
 * control that had focus, which dropped keyboard and screen-reader users
 * on <body> to tab down from the top of the page. (Job Story Mapper keeps
 * the same hook; the two copies can move to src/hooks together.) The caller names where focus goes next —
 * elements under `root` marked `data-focus-key` — and, after the render
 * that shows them, the first one on screen gets focus (or, for a wrapper,
 * its first focusable control). A request is used once: one that matches
 * nothing is dropped, so it can't steal focus later.
 */
export function useFocusAfter(root: RefObject<HTMLElement>): (...keys: string[]) => void {
  const pending = useRef<string[] | null>(null);
  // No deps on purpose: whichever render follows the action shows the target.
  useEffect(() => {
    const keys = pending.current;
    if (!keys) return;
    pending.current = null;
    const marked = Array.from(
      root.current?.querySelectorAll<HTMLElement>("[data-focus-key]") ?? []
    );
    for (const key of keys) {
      const el = marked.find((e) => e.dataset.focusKey === key);
      const target = el && (el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE));
      if (target) {
        target.focus();
        return;
      }
    }
  });
  return useCallback((...keys: string[]) => {
    pending.current = keys;
  }, []);
}
