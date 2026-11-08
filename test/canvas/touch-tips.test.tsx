import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  CanvasTouchTips,
  TOUCH_TIPS_MS,
  TOUCH_TIPS_SEEN_KEY,
  touchTipsCopy,
} from "@/app/(tools)/canvas/components/canvas-touch-tips";

/**
 * First-visit touch tips (mobile audit #72): they were a 7 s bottom toast
 * over the tool rail, the board CTA and Amr, promising a two-finger pan
 * and a long-press menu that didn't work. Now they sit inside the board
 * and say only what the board does.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CanvasTouchTips", () => {
  it("promises only gestures that work", () => {
    expect(touchTipsCopy(false)).toMatchInlineSnapshot(
      `"Pinch to zoom · Drag with two fingers to pan · Long-press an item for actions"`
    );
    // Viewers get no actions menu.
    expect(touchTipsCopy(true)).toMatchInlineSnapshot(
      `"Pinch to zoom · Drag with two fingers to pan"`
    );
  });

  it("shows once per device, inside the board, letting touches through", () => {
    const { unmount } = render(<CanvasTouchTips enabled readOnly={false} />);
    const note = screen.getByRole("note", { name: "Touch tips" });
    expect(note).toHaveTextContent(touchTipsCopy(false));
    expect(note).toHaveClass("pointer-events-none", "absolute");
    const dismiss = screen.getByRole("button", { name: "Dismiss touch tips" });
    expect(dismiss).toHaveClass("pointer-events-auto", "h-11", "w-11");
    expect(localStorage.getItem(TOUCH_TIPS_SEEN_KEY)).toBe("1");
    fireEvent.click(dismiss);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    unmount();

    render(<CanvasTouchTips enabled readOnly={false} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("goes away on its own", () => {
    vi.useFakeTimers();
    render(<CanvasTouchTips enabled readOnly />);
    expect(screen.getByRole("note")).toHaveTextContent(touchTipsCopy(true));
    act(() => {
      vi.advanceTimersByTime(TOUCH_TIPS_MS);
    });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("stays away on mouse devices", () => {
    render(<CanvasTouchTips enabled={false} readOnly={false} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(localStorage.getItem(TOUCH_TIPS_SEEN_KEY)).toBeNull();
  });

  it("is no longer a bottom toast over the tool rail and Amr", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(tools)/canvas/components/whiteboard-canvas.tsx"),
      "utf8"
    );
    expect(src).not.toContain("Tablet tips");
    expect(src).toContain("<CanvasTouchTips");
  });
});
