"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Put focus on a control after an action removes or hides the one that had
 * it (Delete, Remove, Put on the table, a row leaving a filtered list, a form
 * closing), so keyboard and screen-reader users aren't dropped on <body>.
 *
 * The caller names where focus goes next, in order of preference: elements
 * under `root` marked `data-focus-key`. A marked element that can take focus
 * itself (a control, or a heading with tabIndex -1) gets it; a wrapper hands
 * it to its first control. After the render that follows, the first that
 * takes focus gets it. A request is used once, so one that matches nothing
 * can't steal focus later. The same idea as Health Check's helper, which
 * can't focus a heading.
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
      for (const el of marked) {
        if (el.dataset.focusKey !== key) continue;
        const target =
          el.matches(FOCUSABLE) || el.hasAttribute("tabindex")
            ? el
            : el.querySelector<HTMLElement>(FOCUSABLE);
        if (!target) continue;
        target.focus();
        if (document.activeElement === target) return;
      }
    }
  });
  return useCallback((...keys: string[]) => {
    pending.current = keys;
  }, []);
}

/** The ids after and before `id` in `ids`, as `${prefix}${id}` keys: where focus goes when it leaves. */
export function neighbourKeys(ids: readonly string[], id: string, prefix: string): string[] {
  const at = ids.indexOf(id);
  if (at < 0) return [];
  return [ids[at + 1], ids[at - 1]].filter((x): x is string => !!x).map((x) => `${prefix}${x}`);
}
