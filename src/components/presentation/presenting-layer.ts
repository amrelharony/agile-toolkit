"use client";

/**
 * A layer drawn over the whole page while presenting: a visitor room's big
 * screen (`RoomBigScreen`) and wall mode (`WallView`). While one is open:
 *  - the page under it (`#main-content`) is inert, so Tab and a screen
 *    reader's cursor can't reach the controls it hides (End room, Reveal).
 *    The shell's Exit presentation button, the docked timer and the mascot
 *    sit outside `#main-content`, so they still work;
 *  - focus moves onto the layer (`focusRef`, usually its heading);
 *  - when it closes, focus goes back to what had it before (the button that
 *    opened it), if that is still on the page.
 *
 * It also calls `onFullscreenExit` when the browser leaves fullscreen after
 * having entered it (a phone's back gesture, Escape), so the layer closes
 * even where the shell's PresentationController isn't listening.
 */

import { useEffect, useRef, type RefObject } from "react";

export function usePresentingLayer(
  open: boolean,
  focusRef: RefObject<HTMLElement | null>,
  onFullscreenExit?: () => void
): void {
  const exitRef = useRef(onFullscreenExit);
  exitRef.current = onFullscreenExit;

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const page = document.getElementById("main-content");
    // Another layer may have made it inert already: leave that one's to it.
    const madeInert = page !== null && !page.hasAttribute("inert");
    if (madeInert) page.setAttribute("inert", "");
    focusRef.current?.focus();
    return () => {
      if (madeInert) page.removeAttribute("inert");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, focusRef]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    let wasFullscreen = Boolean(document.fullscreenElement);
    const onChange = () => {
      const now = Boolean(document.fullscreenElement);
      if (wasFullscreen && !now) exitRef.current?.();
      wasFullscreen = now;
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [open]);
}
