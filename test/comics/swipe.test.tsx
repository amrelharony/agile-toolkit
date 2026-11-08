/**
 * The comics' sideways swipe (components/use-swipe): far enough, mostly
 * sideways, one finger, at the page's own size, and only past a scroller's edge.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  SWIPE_MIN_PX,
  swipeStep,
  useSwipe,
  type SwipeEdges,
} from "@/app/(tools)/comics/components/use-swipe";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("swipeStep", () => {
  it("moves on for a swipe to the left and back for one to the right", () => {
    expect(swipeStep({ dx: -80, dy: 5, scale: 1 })).toBe(1);
    expect(swipeStep({ dx: 80, dy: -5, scale: 1 })).toBe(-1);
  });

  it("needs the finger to travel far enough", () => {
    expect(swipeStep({ dx: -(SWIPE_MIN_PX - 1), dy: 0, scale: 1 })).toBe(0);
    expect(swipeStep({ dx: -SWIPE_MIN_PX, dy: 0, scale: 1 })).toBe(1);
  });

  it("leaves a mostly upright drag to the page", () => {
    expect(swipeStep({ dx: -80, dy: 60, scale: 1 })).toBe(0);
    expect(swipeStep({ dx: -80, dy: 30, scale: 1 })).toBe(1);
  });

  it("does nothing while the page is pinch-zoomed", () => {
    expect(swipeStep({ dx: -200, dy: 0, scale: 2 })).toBe(0);
    expect(swipeStep({ dx: -200, dy: 0, scale: 1.005 })).toBe(1);
  });
});

function Harness({ onStep, edges }: { onStep: (s: -1 | 1) => void; edges?: () => SwipeEdges }) {
  const swipe = useSwipe(onStep, edges);
  return <div data-testid="pad" {...swipe} />;
}

const pad = () => screen.getByTestId("pad");

function swipe(dx: number, dy = 0, fingers = 1) {
  const touches = Array.from({ length: fingers }, (_, i) => ({
    clientX: 200 + i * 40,
    clientY: 300,
  }));
  fireEvent.touchStart(pad(), { touches, changedTouches: touches });
  fireEvent.touchEnd(pad(), {
    touches: [],
    changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }],
  });
}

describe("useSwipe", () => {
  it("calls back with the step for a swipe past the threshold", () => {
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);
    swipe(-90);
    expect(onStep).toHaveBeenLastCalledWith(1);
    swipe(90);
    expect(onStep).toHaveBeenLastCalledWith(-1);
    swipe(-20);
    swipe(-80, 70);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it("ignores a pinch: a second finger drops the gesture", () => {
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);
    swipe(-90, 0, 2);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("ignores swipes while the page is zoomed in", () => {
    vi.stubGlobal("visualViewport", { scale: 2 });
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);
    swipe(-90);
    expect(onStep).not.toHaveBeenCalled();
    vi.stubGlobal("visualViewport", { scale: 1 });
    swipe(-90);
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it("only moves past the edge the scroller was at when the finger landed", () => {
    const onStep = vi.fn();
    const edges = vi.fn((): SwipeEdges => ({ back: true, on: false }));
    render(<Harness onStep={onStep} edges={edges} />);
    swipe(-90);
    expect(onStep).not.toHaveBeenCalled();
    swipe(90);
    expect(onStep).toHaveBeenCalledWith(-1);
    expect(edges).toHaveBeenCalledTimes(2);
  });

  it("forgets a cancelled gesture", () => {
    const onStep = vi.fn();
    render(<Harness onStep={onStep} />);
    fireEvent.touchStart(pad(), { touches: [{ clientX: 200, clientY: 300 }] });
    fireEvent.touchCancel(pad(), { touches: [] });
    fireEvent.touchEnd(pad(), { touches: [], changedTouches: [{ clientX: 50, clientY: 300 }] });
    expect(onStep).not.toHaveBeenCalled();
  });
});
