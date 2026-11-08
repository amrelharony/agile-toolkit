/**
 * Shared harness for the canvas touch suites. NOT a test file (no `.test`
 * suffix). Renders a stand-in board viewport wired to
 * `useCanvasTouchGestures`, with a plain item (bare board / an object)
 * and a board control (a selection-bar button) inside it.
 *
 * Suites that drive pinches mock `@use-gesture/react` themselves and call
 * the captured handlers; the double-tap / long-press listeners are plain
 * pointer listeners and run as-is.
 */

import { useRef } from "react";
import type { Camera } from "@/lib/geometry/bbox";
import { useCanvasTouchGestures } from "@/app/(tools)/canvas/hooks/use-canvas-touch-gestures";

export function GestureHarness(props: {
  camera?: Camera;
  throttledSetCamera?: (c: Camera) => void;
  setCamera?: (c: Camera) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // The viewport sits at (10, 20): client (110, 120) is board (100, 100).
  const viewportRectRef = useRef<DOMRect | null>({ left: 10, top: 20 } as DOMRect);
  const anyPenActiveRef = useRef(new Set<number>());
  useCanvasTouchGestures({
    viewportRef,
    viewportRectRef,
    camera: props.camera ?? { x: 0, y: 0, zoom: 1 },
    throttledSetCamera: props.throttledSetCamera ?? (() => {}),
    setCamera: props.setCamera ?? (() => {}),
    objects: [],
    viewportSize: { w: 400, h: 300 },
    presentationFrameIndex: null,
    anyPenActiveRef,
  });
  return (
    <div ref={viewportRef} data-testid="viewport">
      <div data-testid="item" />
      <div role="toolbar" aria-label="Object properties">
        <button type="button">Duplicate selection</button>
      </div>
    </div>
  );
}

/** A touch PointerEvent at (50, 60). */
export const touchPointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: "touch",
    pointerId: 1,
    clientX: 50,
    clientY: 60,
    ...init,
  });
