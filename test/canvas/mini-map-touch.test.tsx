import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The board's mini-map on touch screens.
 *
 * On touch the zoom stack (Undo / Redo, full screen, the zoom bar) sits
 * bottom-left (zoom-controls.tsx). From sm up, on a board narrower than
 * about 656 px, the mini-map's corner (right-3 bottom-14, 200x140) came
 * down 10 px over the stack's right end. There it now rises above the
 * stack, and on a short landscape board it shrinks so it never reaches
 * the board toolbar. A mouse keeps the old corner and size.
 */

import {
  MiniMap,
  MINI_MAP_TOUCH_PLACE,
  MINI_MAP_TOUCH_SIZE,
} from "@/app/(tools)/canvas/components/mini-map";
import { ZOOM_CONTROLS_TOUCH_LEFT } from "@/app/(tools)/canvas/components/zoom-controls";

const REM = 16;
const CAMERA = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { w: 800, h: 600 };

function renderMap(onPan = vi.fn()) {
  render(<MiniMap objects={[]} camera={CAMERA} viewportSize={VIEWPORT} onPan={onPan} />);
  const svg = screen.getByRole("img", { name: /Mini-map/ });
  return { svg, wrapper: svg.parentElement as HTMLElement, onPan };
}

/** The touch margin-bottom (px) on a board this wide inside, at a 16 px root. */
function riseAt(width: number) {
  const m = MINI_MAP_TOUCH_PLACE.match(
    /pointer-coarse:mb-\[clamp\(0px,calc\(\(([\d.]+)rem\+(\d+)px-100%\)\*(\d+)\),calc\(([\d.]+)rem\+(\d+)px\)\)\]/
  );
  expect(m).not.toBeNull();
  const [, edgeRem, edgePx, steep, maxRem, maxPx] = m!.map(Number);
  const max = maxRem * REM + maxPx;
  return Math.min(max, Math.max(0, (edgeRem * REM + edgePx - width) * steep));
}

/** The touch map's height (px) on a board this tall inside, at a 16 px root. */
function heightAt(height: number) {
  const m = MINI_MAP_TOUCH_PLACE.match(
    /pointer-coarse:h-\[min\((\d+)px,calc\(100%-([\d.]+)rem-(\d+)px\)\)\]/
  );
  expect(m).not.toBeNull();
  const [, cap, bandRem, bandPx] = m!.map(Number);
  return Math.min(cap, height - bandRem * REM - bandPx);
}

describe("MiniMap on touch", () => {
  it("keeps its corner and size for a mouse", () => {
    const { svg, wrapper } = renderMap();
    expect(wrapper).toHaveClass("absolute", "right-3", "bottom-14", "hidden", "sm:block");
    expect(svg).toHaveAttribute("width", "200");
    expect(svg).toHaveAttribute("height", "140");
    // The drawing area inside the 1 px border: one unit is still one pixel.
    expect(svg).toHaveAttribute("viewBox", "0 0 198 138");
    // Every new class is touch-only.
    for (const c of [...MINI_MAP_TOUCH_PLACE.split(" "), ...MINI_MAP_TOUCH_SIZE.split(" ")]) {
      expect(c.startsWith("pointer-coarse:")).toBe(true);
    }
    const unscoped = (el: Element) =>
      Array.from(el.classList).filter(
        (c) =>
          /(^|:)(m[byt]?|h|w|aspect|bottom|top|inset)-/.test(c) && !c.startsWith("pointer-coarse:")
      );
    expect(unscoped(wrapper)).toEqual(["bottom-14"]);
    expect(unscoped(svg)).toEqual([]);
  });

  it("rises above the zoom stack where the board is too narrow for both", () => {
    const { wrapper } = renderMap();
    expect(wrapper).toHaveClass(...MINI_MAP_TOUCH_PLACE.split(" "));
    // The stack: bottom-3, a 44 px button in a p-1 bordered bar, so its top
    // is 66 px up; from sm up it ends 436 px in (from 4.5rem, 364 px wide).
    expect(ZOOM_CONTROLS_TOUCH_LEFT).toContain("pointer-coarse:left-[4.5rem]");
    const stackTop = 0.75 * REM + 3.25 * REM + 2;
    const stackEnd = 4.5 * REM + 364;
    expect(stackTop).toBe(66);
    // 640x360 (606 px inside) and 667x375 (633 px): 18 px up, 8 px clear.
    for (const width of [606, 633, 655]) {
      expect(width - 12 - 200).toBeLessThan(stackEnd + 8);
      expect(3.5 * REM + riseAt(width)).toBe(stackTop + 8);
    }
    // From 656 px the map clears the stack beside it, and stays put.
    for (const width of [656, 700, 912]) {
      expect(width - 12 - 200).toBeGreaterThanOrEqual(stackEnd + 8);
      expect(riseAt(width)).toBe(0);
    }
  });

  it("never reaches the board toolbar on a short touch board", () => {
    // The toolbar (top-3) ends 66 px down, as the stack's top is 66 px up.
    const toolbarEnd = 0.75 * REM + 3.25 * REM + 2;
    const bottom = 3.5 * REM + riseAt(606);
    // 640x360: 286 px inside, so a 138 px map, 8 px under the toolbar.
    expect(heightAt(286)).toBe(138);
    expect(286 - bottom - heightAt(286)).toBe(toolbarEnd + 8);
    // A shorter board (a browser's bars showing) shrinks it further.
    expect(286 - 60 - bottom - heightAt(286 - 60)).toBe(toolbarEnd + 8);
    // 667x375 and taller boards keep the full 140 px.
    expect(heightAt(301)).toBe(140);
    expect(heightAt(520)).toBe(140);
  });

  it("scales with its height on touch, keeping its shape", () => {
    const { svg } = renderMap();
    expect(MINI_MAP_TOUCH_SIZE).toBe(
      "pointer-coarse:h-full pointer-coarse:w-auto pointer-coarse:aspect-[10/7]"
    );
    expect(svg).toHaveClass(...MINI_MAP_TOUCH_SIZE.split(" "));
  });

  it("pans to the same point when drawn smaller", () => {
    const { svg, onPan } = renderMap();
    const at = (w: number, h: number) =>
      vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
        left: 10,
        top: 20,
        right: 10 + w,
        bottom: 20 + h,
        width: w,
        height: h,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      } as DOMRect);
    // Full size (a mouse): the old mapping. An empty board maps 1:4 from 0,0.
    at(200, 140);
    fireEvent.mouseDown(svg, { clientX: 10 + 100, clientY: 20 + 70 });
    expect(onPan).toHaveBeenLastCalledWith(400, 280);
    // Half size (a short touch board): the same spot on the map, same point.
    at(100, 70);
    fireEvent.mouseDown(svg, { clientX: 10 + 50, clientY: 20 + 35 });
    expect(onPan).toHaveBeenLastCalledWith(400, 280);
  });
});
