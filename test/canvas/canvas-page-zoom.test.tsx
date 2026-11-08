import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Browser zoom on /canvas (mobile audit #70). The route locked zoom for
 * the whole page (maximum-scale=1, user-scalable=no), so its text could
 * not be pinch-zoomed on Android (WCAG 1.4.4). The lock is gone; the
 * board's viewport is `touch-action: none` and cancels the page's pinch
 * itself (Safari's gesture events, two-finger touchmove), so a pinch on
 * the board still zooms the board, not the page.
 */

vi.mock("@/app/(tools)/canvas/canvas-client", () => ({ CanvasClient: () => null }));

import * as canvasPage from "@/app/(tools)/canvas/page";
import { useBoardPinchGuard } from "@/app/(tools)/canvas/hooks/use-board-pinch-guard";

describe("/canvas viewport", () => {
  it("leaves browser zoom on for the page", () => {
    const page = canvasPage as Record<string, unknown>;
    // No per-route override at all: the app-wide viewport (zoom on) holds.
    expect(page.viewport).toBeUndefined();
    const viewport = (page.viewport ?? {}) as Record<string, unknown>;
    expect(viewport).not.toHaveProperty("userScalable");
    expect(viewport).not.toHaveProperty("maximumScale");
  });
});

function GuardHarness() {
  const ref = useRef<HTMLDivElement>(null);
  useBoardPinchGuard(ref);
  return (
    <div>
      <div ref={ref} data-testid="board">
        <span data-testid="inside" />
      </div>
      <div data-testid="page" />
    </div>
  );
}

function touchMove(fingers: number) {
  const e = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: Array.from({ length: fingers }, () => ({})) });
  return e;
}

describe("useBoardPinchGuard", () => {
  it("cancels a two-finger move on the board, so the page doesn't zoom", () => {
    render(<GuardHarness />);
    const pinch = touchMove(2);
    screen.getByTestId("inside").dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
  });

  it("leaves one finger alone", () => {
    render(<GuardHarness />);
    const drag = touchMove(1);
    screen.getByTestId("board").dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(false);
  });

  it("cancels Safari's pinch events on the board", () => {
    render(<GuardHarness />);
    for (const type of ["gesturestart", "gesturechange"]) {
      const e = new Event(type, { bubbles: true, cancelable: true });
      screen.getByTestId("board").dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
  });

  it("leaves the rest of the page free to pinch-zoom", () => {
    render(<GuardHarness />);
    const pinch = touchMove(2);
    screen.getByTestId("page").dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
    const gesture = new Event("gesturestart", { bubbles: true, cancelable: true });
    screen.getByTestId("page").dispatchEvent(gesture);
    expect(gesture.defaultPrevented).toBe(false);
  });

  it("lets go when the board unmounts", () => {
    const { unmount } = render(<GuardHarness />);
    const board = screen.getByTestId("board");
    unmount();
    const pinch = touchMove(2);
    board.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
  });
});
