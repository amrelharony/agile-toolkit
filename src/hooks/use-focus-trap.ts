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
  opts: { active: boolean; initialFocusRef?: React.RefObject<HTMLElement> } = { active: true }
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

    // BUG-W1: capture the previously-focused element exactly ONCE per
    // open cycle. The prior implementation overwrote `previousActiveRef`
    // on every effect re-run, which (under React 18 StrictMode or any
    // re-effect mid-dialog) snapshotted an element INSIDE the dialog —
    // unmount then "restored" focus to that now-removed element and
    // focus landed on <body>.
    if (previousActiveRef.current === null) {
      previousActiveRef.current = (document.activeElement as HTMLElement | null) ?? null;
    }
    // Track whether we set body[tabindex=-1] this cycle so we can clean
    // up on unmount. (BUG-W2)
    let setBodyTabindex = false;

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
      // case where the trigger has been removed from the DOM (peer
      // deleted the source object, user navigated away with the
      // dialog open, parent re-mounted). R11-fix: when the trigger is
      // gone, fall back to a stable landing target rather than letting
      // focus drop to <body> (where screen readers announce nothing,
      // violating WCAG 2.4.3 focus-order).
      const prev = previousActiveRef.current;
      if (prev && document.contains(prev) && typeof prev.focus === "function") {
        prev.focus();
        return;
      }
      // Fallbacks in order: skip-to-content link, top toolbar, main h1,
      // or body with tabindex -1 (so SRs at least announce the landmark).
      const fallback =
        document.querySelector<HTMLElement>('[data-skip-link="true"]') ??
        document.querySelector<HTMLElement>("header [role='button'], header button") ??
        document.querySelector<HTMLElement>("main h1, [role='main'] h1") ??
        document.body;
      if (fallback === document.body) {
        // body isn't focusable by default — promote so SR/keyboard
        // users have somewhere meaningful to land. Tabindex -1 keeps it
        // out of the natural Tab order but allows programmatic focus.
        if (!document.body.hasAttribute("tabindex")) {
          document.body.setAttribute("tabindex", "-1");
          setBodyTabindex = true;
        }
      }
      fallback.focus?.();
      // BUG-W2: clean up the body tabindex we added so it doesn't
      // pollute the focus graph for the rest of the session.
      if (setBodyTabindex) {
        // Defer removal so the focus call above lands first; otherwise
        // some browsers refuse to focus an element we just stripped the
        // tabindex from.
        queueMicrotask(() => {
          if (document.body.getAttribute("tabindex") === "-1") {
            document.body.removeAttribute("tabindex");
          }
        });
      }
      // Reset the captured-previous-active ref so the NEXT open cycle
      // captures a fresh trigger (BUG-W1 cont.).
      previousActiveRef.current = null;
    };
    // initialFocusRef intentionally not in deps — the ref object should be
    // stable; if a caller passes a new ref while `active` stays true, the
    // change is honoured on the next `active` flip.
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
    // BUG-W42: `offsetParent === null` is also true when ANY ancestor
    // is `position:fixed`, not just when the element itself is hidden.
    // Prefer Element.checkVisibility() (modern browsers) and fall back
    // to the old heuristic with an ancestor walk.
    type ElWithCV = HTMLElement & {
      checkVisibility?: (opts?: { visibilityProperty?: boolean }) => boolean;
    };
    const elCv = el as ElWithCV;
    if (typeof elCv.checkVisibility === "function") {
      if (!elCv.checkVisibility({ visibilityProperty: true })) return false;
      return true;
    }
    if (el.offsetParent === null) {
      // Walk up to find whether any ancestor is fixed-positioned. If so,
      // treat as visible (the offsetParent quirk is misleading).
      let n: HTMLElement | null = el;
      let hasFixedAncestor = false;
      while (n && n !== container) {
        if (getComputedStyle(n).position === "fixed") {
          hasFixedAncestor = true;
          break;
        }
        n = n.parentElement;
      }
      if (!hasFixedAncestor && getComputedStyle(el).position !== "fixed") return false;
    }
    return true;
  });
}
