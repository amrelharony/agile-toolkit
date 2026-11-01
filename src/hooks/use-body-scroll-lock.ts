"use client";

import { useEffect } from "react";

/**
 * Ref-counted body scroll lock shared with the mobile sidebar and dialogs
 * (see sidebar.tsx): each owner bumps `window.__scrollLockCount`, and only
 * the last one out restores the original overflow.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    type W = Window & { __scrollLockCount?: number; __scrollLockPrev?: string };
    const w = window as W;
    if ((w.__scrollLockCount ?? 0) === 0) {
      w.__scrollLockPrev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    w.__scrollLockCount = (w.__scrollLockCount ?? 0) + 1;
    return () => {
      w.__scrollLockCount = Math.max(0, (w.__scrollLockCount ?? 1) - 1);
      if (w.__scrollLockCount === 0) {
        document.body.style.overflow = w.__scrollLockPrev ?? "";
        delete w.__scrollLockPrev;
      }
    };
  }, [active]);
}
