import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePageSwipe } from "@/components/comic/reader/hooks/use-page-swipe";

/**
 * Swipe-to-turn on the comic stage. Unlike useSwipeToClose it must ignore
 * pointercancel (the browser took over a scroll or pinch), abandon the
 * gesture when a second finger lands, and need ≥ 50 px of mostly
 * horizontal travel.
 */

function pointer(
  el: HTMLElement,
  type: "pointerdown" | "pointerup" | "pointercancel",
  init: { id?: number; x: number; y?: number; pointerType?: string }
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId: init.id ?? 1,
      pointerType: init.pointerType ?? "touch",
      clientX: init.x,
      clientY: init.y ?? 100,
    })
  );
}

function setup(enabled = true) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const onSwipeLeft = vi.fn();
  const onSwipeRight = vi.fn();
  const hook = renderHook(
    ({ on }) => usePageSwipe(el, { onSwipeLeft, onSwipeRight, enabled: on }),
    { initialProps: { on: enabled } }
  );
  return { el, onSwipeLeft, onSwipeRight, hook };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("usePageSwipe", () => {
  it("turns on a long, mostly horizontal swipe", () => {
    const { el, onSwipeLeft, onSwipeRight, hook } = setup();
    pointer(el, "pointerdown", { x: 300 });
    pointer(el, "pointerup", { x: 200, y: 120 });
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    // The click that may follow the swipe is to be ignored by tap zones.
    expect(hook.result.current.recentlySwiped()).toBe(true);

    pointer(el, "pointerdown", { x: 100 });
    pointer(el, "pointerup", { x: 180 });
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it("ignores short or mostly vertical drags", () => {
    const { el, onSwipeLeft, onSwipeRight, hook } = setup();
    pointer(el, "pointerdown", { x: 300 });
    pointer(el, "pointerup", { x: 260 });
    pointer(el, "pointerdown", { x: 300, y: 100 });
    pointer(el, "pointerup", { x: 200, y: 260 });
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
    expect(hook.result.current.recentlySwiped()).toBe(false);
  });

  it("never turns on pointercancel", () => {
    const { el, onSwipeLeft } = setup();
    pointer(el, "pointerdown", { x: 300 });
    pointer(el, "pointercancel", { x: 100 });
    pointer(el, "pointerup", { x: 100 });
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it("abandons the gesture when a second finger lands (pinch)", () => {
    const { el, onSwipeLeft } = setup();
    pointer(el, "pointerdown", { id: 1, x: 300 });
    pointer(el, "pointerdown", { id: 2, x: 320 });
    pointer(el, "pointerup", { id: 1, x: 100 });
    pointer(el, "pointerup", { id: 2, x: 100 });
    expect(onSwipeLeft).not.toHaveBeenCalled();

    // A fresh single-finger swipe works again afterwards.
    pointer(el, "pointerdown", { id: 3, x: 300 });
    pointer(el, "pointerup", { id: 3, x: 100 });
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it("ignores the mouse and does nothing while disabled (zoomed)", () => {
    const { el, onSwipeLeft, hook } = setup();
    pointer(el, "pointerdown", { x: 300, pointerType: "mouse" });
    pointer(el, "pointerup", { x: 100, pointerType: "mouse" });
    expect(onSwipeLeft).not.toHaveBeenCalled();

    hook.rerender({ on: false });
    pointer(el, "pointerdown", { x: 300 });
    pointer(el, "pointerup", { x: 100 });
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });
});
