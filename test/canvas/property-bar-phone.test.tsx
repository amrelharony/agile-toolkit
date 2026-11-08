import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { stickyFixture } from "./object-fixtures";

/**
 * The selection property bar on phones (mobile audit #21, #24). It was
 * centred on the object with no clamp and a `95vw` cap wider than a
 * phone's stage, so the stage clipped one end ("Tags" unreachable). Its
 * colour swatches were 14 px with 2 px gaps and the font buttons 24 px
 * tall. Now it stays inside the stage and its controls are 44 px on
 * touch, with the desktop sizes unchanged.
 */

import {
  BAR_EDGE_MARGIN,
  PropertyPanel,
  clampBarCenterX,
} from "@/app/(tools)/canvas/components/property-panel";

describe("clampBarCenterX", () => {
  const STAGE = 336; // the 360 px phone's stage

  it("keeps the selection's centre when the bar fits there", () => {
    expect(clampBarCenterX(168, 200, STAGE)).toBe(168);
  });

  it("moves the bar in from the right edge, 8 px clear", () => {
    const left = clampBarCenterX(250, 200, STAGE);
    expect(left + 100).toBe(STAGE - BAR_EDGE_MARGIN);
  });

  it("moves the bar in from the left edge, 8 px clear", () => {
    const left = clampBarCenterX(20, 200, STAGE);
    expect(left - 100).toBe(BAR_EDGE_MARGIN);
  });

  it("centres a bar as wide as the stage allows", () => {
    expect(clampBarCenterX(300, STAGE - 2 * BAR_EDGE_MARGIN, STAGE)).toBe(STAGE / 2);
    expect(clampBarCenterX(10, STAGE, STAGE)).toBe(STAGE / 2);
  });

  it("leaves the centre alone before anything is measured", () => {
    expect(clampBarCenterX(250, 0, STAGE)).toBe(250);
    expect(clampBarCenterX(250, 200, 0)).toBe(250);
  });
});

describe("PropertyPanel inside the stage", () => {
  beforeEach(() => {
    // jsdom has no layout: the bar measures 200 px wide.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const props = {
    selection: [stickyFixture()],
    camera: { x: 0, y: 0, zoom: 1 },
    viewportHeight: 600,
    onPatch: vi.fn(),
  };
  const bar = () => screen.getByRole("toolbar", { name: "Object properties" });

  it("clamps a bar over an object near the right edge", () => {
    // Object x 150–350 on a 336 px stage: centred, the bar would run to 350.
    render(
      <PropertyPanel
        {...props}
        selectionBbox={{ x: 150, y: 200, w: 200, h: 160 }}
        viewportWidth={336}
      />
    );
    expect(bar().style.left).toBe(`${336 - 8 - 100}px`);
    expect(bar().style.transform).toBe("translateX(-50%)");
  });

  it("clamps a bar over an object near the left edge", () => {
    render(
      <PropertyPanel
        {...props}
        selectionBbox={{ x: -20, y: 200, w: 200, h: 160 }}
        viewportWidth={336}
      />
    );
    expect(bar().style.left).toBe(`${8 + 100}px`);
  });

  it("stays centred over an object with room either side", () => {
    render(
      <PropertyPanel
        {...props}
        selectionBbox={{ x: 68, y: 200, w: 200, h: 160 }}
        viewportWidth={336}
      />
    );
    expect(bar().style.left).toBe("168px");
  });

  it("caps its width at the stage, not the window", () => {
    render(<PropertyPanel {...props} selectionBbox={{ x: 68, y: 200, w: 200, h: 160 }} />);
    expect(bar()).toHaveClass("w-max", "max-w-[min(calc(100%-1rem),640px)]");
    expect(bar().className).not.toMatch(/95vw/);
  });
});

describe("PropertyPanel touch sizes", () => {
  const renderSticky = (onPatch = vi.fn()) =>
    render(
      <PropertyPanel
        selection={[stickyFixture()]}
        selectionBbox={{ x: 100, y: 200, w: 200, h: 160 }}
        camera={{ x: 0, y: 0, zoom: 1 }}
        viewportHeight={600}
        onPatch={onPatch}
      />
    );

  it("gives every colour swatch a 44 px touch target around a small dot", () => {
    renderSticky();
    for (const name of ["Sticky color", "Text"]) {
      const swatches = within(screen.getByRole("group", { name })).getAllByRole("button");
      expect(swatches.length).toBeGreaterThan(5);
      for (const b of swatches) {
        expect(b).toHaveClass("pointer-coarse:h-11", "pointer-coarse:w-11", "shrink-0");
        // The visible dot: 14 px with a mouse (unchanged), 20 px on touch.
        const dot = b.firstElementChild as HTMLElement;
        expect(dot).toHaveClass("w-3.5", "h-3.5", "rounded-full", "pointer-coarse:w-5");
        expect(dot).toHaveAttribute("aria-hidden", "true");
      }
    }
  });

  it("swatches still set the colour", () => {
    const onPatch = vi.fn();
    renderSticky(onPatch);
    fireEvent.click(screen.getByRole("button", { name: "Set color #fca5a5" }));
    expect(onPatch).toHaveBeenCalledWith([
      expect.objectContaining({ patch: { color: "#fca5a5" } }),
    ]);
  });

  it("makes font size, font family and Tags 44 px on touch", () => {
    renderSticky();
    const buttons = [
      ...within(screen.getByRole("group", { name: "Font size" })).getAllByRole("button"),
      ...within(screen.getByRole("group", { name: "Font family" })).getAllByRole("button"),
      screen.getByRole("button", { name: "Tags" }),
    ];
    for (const b of buttons) {
      expect(b).toHaveClass("pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
    }
    // Desktop density unchanged.
    expect(screen.getByRole("button", { name: "Font size 16" })).toHaveClass("h-6", "min-w-[22px]");
  });
});
