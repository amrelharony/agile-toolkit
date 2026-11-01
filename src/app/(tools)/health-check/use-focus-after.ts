"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Put focus back on a control after an action removes the one that had it
 * (Delete, Archive, Clear, a "Send" that becomes a link), so keyboard and
 * screen-reader users aren't dropped on <body>. The caller names where
 * focus goes next, in order of preference: elements under `root` marked
 * `data-focus-key` (or, for a wrapper, its first focusable control). After
 * the render that follows, the first that takes focus gets it.
 *
 * Epic Roadmap has the same idea; this one tries every element marked with
 * a key, because a DataTable renders its rows twice (the table, and the
 * cards for a phone) and only one of them is on screen. A request is used
 * once: one that matches nothing is dropped, so it can't steal focus later.
 * Shared by the Health Check, Psych Safety and Mood Tracker pages.
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
        const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
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

/** Where focus goes after row `id` of `ids` is removed: the row after it, else the one before. */
export function neighbourKeys(ids: readonly string[], id: string, prefix: string): string[] {
  const at = ids.indexOf(id);
  if (at < 0) return [];
  return [ids[at + 1], ids[at - 1]].filter((x): x is string => !!x).map((x) => `${prefix}${x}`);
}
