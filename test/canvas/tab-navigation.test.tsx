import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTabNavigation } from "@/app/(tools)/canvas/hooks/use-tab-navigation";

const objects = [
  { id: "a", x: 0, y: 0, w: 10, h: 10, z: 1 },
  { id: "b", x: 20, y: 0, w: 10, h: 10, z: 2 },
];

function setup(selection: string[]) {
  const viewport = document.createElement("div");
  viewport.tabIndex = 0;
  const outside = document.createElement("button");
  document.body.append(viewport, outside);
  const setSelection = vi.fn();
  renderHook(() =>
    useTabNavigation({
      objects,
      selection,
      size: { w: 800, h: 600 },
      camera: { x: 0, y: 0, zoom: 1 },
      setSelection,
      setCamera: vi.fn(),
      viewportRef: { current: viewport },
    })
  );
  const tab = (target: HTMLElement, shiftKey = false) => {
    const e = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(e);
    return e;
  };
  return { viewport, outside, setSelection, tab };
}

describe("canvas Tab navigation", () => {
  it("leaves Tab alone outside the board (no keyboard trap)", () => {
    const { outside, setSelection, tab } = setup([]);
    const e = tab(outside);
    expect(e.defaultPrevented).toBe(false);
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("cycles objects while focus is on the board", () => {
    const { viewport, setSelection, tab } = setup([]);
    const e = tab(viewport);
    expect(e.defaultPrevented).toBe(true);
    expect(setSelection).toHaveBeenCalledWith(["a"]);
  });

  it("lets focus leave the board after the last object", () => {
    const { viewport, setSelection, tab } = setup(["b"]);
    const e = tab(viewport);
    expect(e.defaultPrevented).toBe(false);
    expect(setSelection).toHaveBeenCalledWith([]);
  });
});
