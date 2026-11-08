import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Camera } from "@/lib/geometry/bbox";

/**
 * Two-finger drag pans the board (mobile audit #22). @use-gesture reports
 * any two-finger contact as a pinch, so onDrag's pan never ran; the pinch
 * now pans by how far its centre travels.
 */

// @use-gesture's recognisers need real multi-touch; capture the handlers
// the hook registers and drive them directly.
type GestureState = Record<string, unknown>;
const gesture = vi.hoisted(() => ({
  handlers: null as null | Record<string, (state: GestureState) => unknown>,
}));
vi.mock("@use-gesture/react", () => ({
  useGesture: (handlers: Record<string, (state: GestureState) => unknown>) => {
    gesture.handlers = handlers;
  },
}));
vi.mock("@/lib/whiteboard/canvas-transform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whiteboard/canvas-transform")>();
  return { ...actual, panBy: vi.fn(actual.panBy) };
});

import { panBy } from "@/lib/whiteboard/canvas-transform";
import { pinchCamera } from "@/app/(tools)/canvas/hooks/use-canvas-touch-gestures";
import { GestureHarness } from "./touch-harness";

const touch = { pointerType: "touch" };

/** Screen position of world point `w` under `cam`. */
const toScreen = (cam: Camera, w: { x: number; y: number }) => ({
  x: (w.x - cam.x) * cam.zoom,
  y: (w.y - cam.y) * cam.zoom,
});

describe("pinchCamera", () => {
  it("pans by the centre's travel when the fingers slide together", () => {
    const start = { camera: { x: 0, y: 0, zoom: 2 }, focal: { x: 100, y: 100 } };
    expect(pinchCamera(start, { x: 160, y: 140 }, 1)).toEqual({ x: -30, y: -20, zoom: 2 });
  });

  it("zooms about the centre when the fingers spread in place", () => {
    const start = { camera: { x: 0, y: 0, zoom: 1 }, focal: { x: 100, y: 100 } };
    expect(pinchCamera(start, { x: 100, y: 100 }, 2)).toEqual({ x: 50, y: 50, zoom: 2 });
  });

  it("keeps the board point under the fingers under them while they pinch and move", () => {
    const camera = { x: 5, y: -3, zoom: 1.5 };
    const f0 = { x: 80, y: 60 };
    const f1 = { x: 140, y: 30 };
    const world = { x: camera.x + f0.x / camera.zoom, y: camera.y + f0.y / camera.zoom };
    const next = pinchCamera({ camera, focal: f0 }, f1, 1.8);
    expect(next.zoom).toBeCloseTo(2.7);
    const at = toScreen(next, world);
    expect(at.x).toBeCloseTo(f1.x);
    expect(at.y).toBeCloseTo(f1.y);
  });
});

describe("useCanvasTouchGestures: two-finger pan", () => {
  it("pans with panBy by the pinch origin's travel", () => {
    const throttledSetCamera = vi.fn();
    render(
      <GestureHarness camera={{ x: 0, y: 0, zoom: 2 }} throttledSetCamera={throttledSetCamera} />
    );
    const onPinch = gesture.handlers!.onPinch;
    // Client (110, 120) is board (100, 100).
    const memo = onPinch({ origin: [110, 120], offset: [1, 0], event: touch, first: true });
    vi.mocked(panBy).mockClear();
    onPinch({ origin: [170, 160], offset: [1, 0], event: touch, first: false, memo });
    expect(panBy).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 2 }, 60, 40);
    expect(throttledSetCamera).toHaveBeenLastCalledWith({ x: -30, y: -20, zoom: 2 });
  });

  it("doesn't lose steps while the throttled camera lags behind the fingers", () => {
    const throttledSetCamera = vi.fn();
    // The camera prop never updates here, as within one rAF frame.
    render(
      <GestureHarness camera={{ x: 0, y: 0, zoom: 1 }} throttledSetCamera={throttledSetCamera} />
    );
    const onPinch = gesture.handlers!.onPinch;
    const memo = onPinch({ origin: [110, 120], offset: [1, 0], event: touch, first: true });
    onPinch({ origin: [130, 120], offset: [1, 0], event: touch, first: false, memo });
    onPinch({ origin: [150, 120], offset: [1, 0], event: touch, first: false, memo });
    expect(throttledSetCamera).toHaveBeenLastCalledWith({ x: -40, y: 0, zoom: 1 });
  });

  it("still zooms a plain pinch about its centre", () => {
    const throttledSetCamera = vi.fn();
    render(
      <GestureHarness camera={{ x: 0, y: 0, zoom: 1 }} throttledSetCamera={throttledSetCamera} />
    );
    const onPinch = gesture.handlers!.onPinch;
    const memo = onPinch({ origin: [110, 120], offset: [1, 0], event: touch, first: true });
    onPinch({ origin: [110, 120], offset: [2, 0], event: touch, first: false, memo });
    expect(throttledSetCamera).toHaveBeenLastCalledWith({ x: 50, y: 50, zoom: 2 });
  });

  it("keeps Ctrl+wheel and trackpad zoom about the cursor, without panning", () => {
    const throttledSetCamera = vi.fn();
    render(
      <GestureHarness camera={{ x: 0, y: 0, zoom: 1 }} throttledSetCamera={throttledSetCamera} />
    );
    const onPinch = gesture.handlers!.onPinch;
    const wheel = new WheelEvent("wheel", { ctrlKey: true });
    // Client (110, 120) is board (100, 100); the cursor then drifts 60 px.
    const memo = onPinch({ origin: [110, 120], offset: [1, 0], event: wheel, first: true });
    vi.mocked(panBy).mockClear();
    onPinch({ origin: [170, 120], offset: [1, 0], event: wheel, first: false, memo });
    // Same zoom, so nothing moves: the board doesn't follow the cursor.
    expect(panBy).not.toHaveBeenCalled();
    expect(throttledSetCamera).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 1 });
    // And it still zooms about where the cursor is now.
    onPinch({ origin: [170, 120], offset: [2, 0], event: wheel, first: false, memo });
    expect(throttledSetCamera).toHaveBeenLastCalledWith({ x: 80, y: 50, zoom: 2 });
  });

  it("leaves mouse and pen pinches alone", () => {
    const throttledSetCamera = vi.fn();
    render(<GestureHarness throttledSetCamera={throttledSetCamera} />);
    gesture.handlers!.onPinch({
      origin: [110, 120],
      offset: [2, 0],
      event: { pointerType: "mouse" },
      first: true,
    });
    expect(throttledSetCamera).not.toHaveBeenCalled();
  });
});
