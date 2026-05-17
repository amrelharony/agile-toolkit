"use client";

import { useEffect, useRef } from "react";

/**
 * Focus-trap hook for hand-rolled modals/dialogs.
 *
 * R10-deferred: the canvas modals (share-modal, template-gallery,
 * import-modal, card-detail-modal) all use a `<div role="dialog"
 * aria-modal="true">` pattern instead of Radix Dialog. Without a
 * proper focus trap, Tab escapes back to the underlying canvas
 * (WCAG 2.4.3 fail). Migrating each one to Radix Dialog is a
 * substantial refactor; this hook gives the focus-trap behaviour
 * without ripping out the layout.
 *
 * What it does:
 *   1. On mount, captures `document.activeElement` so it can be
 *      restored on close.
 *   2. Moves focus to the first focusable element inside the
 *      container (or an explicit `initialFocusRef` if provided).
 *   3. Intercepts `Tab` / `Shift+Tab` to wrap within the container.
 *   4. On unmount, restores focus to the original trigger.
 *
 * Usage:
 *
 *   const dialogRef = useRef<HTMLDivElement>(null);
 *   useFocusTrap(dialogRef, { active: open });
 *   return open ? <div role="dialog" aria-modal="true" ref={dialogRef}>…</div> : null;
 *
 * The `active` flag lets the consumer toggle the trap without
 * unmounting the hook tree.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement>,
  opts: { active: boolean; initialFocusRef?: React.RefObject<HTMLElement> } = { active: true },
): void {
  const { active, initialFocusRef } = opts;
  // Hold the previously-focused element across renders — restoring on
  // unmount is the WCAG 2.4.3 piece that completes the round-trip
  // (focus came from the trigger, focus returns to the trigger).
  const previousActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Capture the current focus so we can restore it on unmount.
    previousActiveRef.current = (document.activeElement as HTMLElement | null) ?? null;

    // Move focus into the dialog. Prefer the explicit ref; fall back
    // to the first tabbable child; last resort is the container itself.
    const focusFirst = () => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }
      const first = getFocusableElements(container)[0];
      if (first) first.focus();
      else {
        // Make the container itself focusable as a fallback so SR users
        // land somewhere meaningful (the dialog has aria-label).
        if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
        container.focus();
      }
    };

    // Defer one tick so the dialog is fully painted before focus moves
    // — avoids a one-frame flash where the trigger keeps the ring.
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        // Nothing focusable inside — pin focus to the container.
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus to the original trigger element. Guard for the
      // case where the trigger has been removed from the DOM (rare —
      // user navigated away with the dialog open).
      const prev = previousActiveRef.current;
      if (prev && document.contains(prev) && typeof prev.focus === "function") {
        prev.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/** Tabbable selector list. Keeps the trap aligned with the browser's
 *  notion of "focusable" — buttons/inputs/links/etc with non-negative
 *  tabindex and not disabled/aria-hidden. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    // Filter out aria-hidden subtrees and elements with display:none /
    // visibility:hidden that the browser would skip anyway.
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest("[aria-hidden='true']")) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
    return true;
  });
}
