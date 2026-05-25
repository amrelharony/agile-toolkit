"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Input-class detection for tablet / stylus optimisation.
 *
 * - `isCoarse` — true when the primary pointer is touch (phones, tablets).
 *   Drives bigger hit areas on selection / connector handles.
 * - `hasPen` — true when the device has reported a `pointerType === "pen"`
 *   event at least once (Xiaomi Pen, Apple Pencil, Surface Pen, etc.).
 *   The `(any-pointer: fine)` media query is unreliable on Android — a
 *   Xiaomi Pad advertises only `coarse` until the pen actually touches
 *   the screen — so we also flip the flag from the live pointer stream.
 * - `anyPenActiveRef` — set of pointerIds currently in contact, tracked
 *   via WINDOW-level listeners so the counter stays accurate even when
 *   a child element (e.g. a table cell) takes pointer-capture and the
 *   viewport never sees the pointerup. Exposed as a `.size > 0` check
 *   under `anyPenActiveRef.current.size` for palm rejection.
 *
 * Window-level tracking is the load-bearing piece: handlers attached
 * to the viewport miss pointerups whose capture moved to a child, which
 * would otherwise leak the counter and lock palm rejection on forever.
 */
export interface InputClass {
  isCoarse: boolean;
  hasPen: boolean;
  /** Set of pointerIds of pens currently in contact. Use `.size` to test. */
  anyPenActiveRef: React.MutableRefObject<Set<number>>;
}

export function useInputClass(): InputClass {
  const anyPenActiveRef = useRef<Set<number>>(new Set());
  const [isCoarse, setIsCoarse] = useState(false);
  const [hasPen, setHasPen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const coarseMq = window.matchMedia("(pointer: coarse)");
    const penMq = window.matchMedia("(any-pointer: fine)");
    const apply = () => {
      setIsCoarse(coarseMq.matches);
      setHasPen((prev) => prev || penMq.matches);
    };
    apply();
    coarseMq.addEventListener("change", apply);
    penMq.addEventListener("change", apply);
    return () => {
      coarseMq.removeEventListener("change", apply);
      penMq.removeEventListener("change", apply);
    };
  }, []);

  // Window-level pen tracking. Bubbled pointer events reach the window
  // even when a child element has pointer-capture, so the counter
  // stays accurate across capture transitions (table cells, rich-text
  // editors, anywhere setPointerCapture moves capture off the viewport).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "pen") {
        anyPenActiveRef.current.add(e.pointerId);
        setHasPen(true);
      }
    };
    const onRelease = (e: PointerEvent) => {
      if (e.pointerType === "pen") anyPenActiveRef.current.delete(e.pointerId);
    };
    // pointerleave catches the case where the OS revokes the pen mid-air
    // (battery drop, etc.) without firing pointerup or pointercancel.
    window.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("pointerup", onRelease, { capture: true });
    window.addEventListener("pointercancel", onRelease, { capture: true });
    window.addEventListener("pointerleave", onRelease, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointerup", onRelease, { capture: true });
      window.removeEventListener("pointercancel", onRelease, { capture: true });
      window.removeEventListener("pointerleave", onRelease, { capture: true });
    };
  }, []);

  return { isCoarse, hasPen, anyPenActiveRef };
}
