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

  it("counts as seen only once the card is on screen", () => {
    // The board often starts below the fold on a phone: the flag and the
    // countdown wait for the card to scroll into view.
    vi.useFakeTimers();
    const observers: { cb: IntersectionObserverCallback; disconnect: () => void }[] = [];
    class FakeObserver {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    // Set by hand, not vi.stubGlobal: unstubAllGlobals would also drop
    // test/setup.ts's matchMedia stub.
    const g = globalThis as { IntersectionObserver?: unknown };
    const original = g.IntersectionObserver;
    g.IntersectionObserver = FakeObserver;
    try {
      render(<CanvasTouchTips enabled readOnly={false} />);
      const note = screen.getByRole("note");
      const report = (ratio: number) =>
        act(() => {
          observers.at(-1)!.cb(
            [
              {
                isIntersecting: ratio > 0,
                intersectionRatio: ratio,
              } as IntersectionObserverEntry,
            ],
            observers.at(-1) as unknown as IntersectionObserver
          );
        });
      // Below the fold: still waiting, long past the countdown.
      report(0);
      act(() => {
        vi.advanceTimersByTime(TOUCH_TIPS_MS * 2);
      });
      expect(note).toBeInTheDocument();
      expect(localStorage.getItem(TOUCH_TIPS_SEEN_KEY)).toBeNull();
      // Barely peeking in doesn't count either.
      report(0.2);
      expect(localStorage.getItem(TOUCH_TIPS_SEEN_KEY)).toBeNull();
      // On screen: remembered, and the countdown starts now.
      report(0.6);
      expect(localStorage.getItem(TOUCH_TIPS_SEEN_KEY)).toBe("1");
      act(() => {
        vi.advanceTimersByTime(TOUCH_TIPS_MS - 1);
      });
      expect(screen.getByRole("note")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    } finally {
      if (original === undefined) delete g.IntersectionObserver;
      else g.IntersectionObserver = original;
    }
  });

  it("sits below the tag filter row, which would cover its dismiss button", () => {
    // TagFilterRow is `absolute top-14 z-10`, about 56-88 px down.
    render(<CanvasTouchTips enabled readOnly={false} />);
    expect(screen.getByRole("note")).toHaveClass("top-24");
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
