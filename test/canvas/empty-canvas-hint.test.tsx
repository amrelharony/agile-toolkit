import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The empty-board hint (mobile audit #67) said "Hold Space + drag to pan ·
 * scroll to zoom" on touch screens too, and sat centred under the zoom
 * bar, whose translucent fill garbled both. On touch it now gives the
 * touch gestures and sits above the zoom controls, which move bottom-left
 * there (ZOOM_CONTROLS_TOUCH_LEFT). A mouse keeps the old hint and place.
 */

import {
  EmptyCanvasHint,
  EMPTY_HINT_TOUCH_PLACE,
  TOUCH_NAV_HINT,
} from "@/app/(tools)/canvas/components/canvas-overlays";

describe("EmptyCanvasHint", () => {
  it("keeps the keyboard hint, centred at the bottom, for a mouse", () => {
    render(<EmptyCanvasHint objectCount={0} />);
    const kbd = screen.getByText("Space");
    const desktop = kbd.parentElement!;
    expect(desktop).toHaveClass("pointer-coarse:hidden");
    expect(desktop.textContent).toBe("Hold Space + drag to pan · scroll to zoom");
    const hint = desktop.parentElement!;
    expect(hint).toHaveClass(
      "absolute",
      "bottom-3",
      "left-1/2",
      "-translate-x-1/2",
      "pointer-events-none"
    );
  });

  it("gives touch gestures on a touch screen, above the zoom controls", () => {
    render(<EmptyCanvasHint objectCount={0} />);
    const touch = screen.getByText(TOUCH_NAV_HINT);
    expect(TOUCH_NAV_HINT).toBe("Pinch to zoom · drag with two fingers to pan");
    expect(touch).toHaveClass("hidden", "pointer-coarse:inline");
    const hint = touch.parentElement!;
    for (const c of EMPTY_HINT_TOUCH_PLACE.split(" ")) expect(hint).toHaveClass(c);
    // Lined up with the zoom stack (left-[4.5rem] on touch), above it:
    // two rows on phones, one from sm up.
    expect(hint).toHaveClass(
      "pointer-coarse:left-[4.5rem]",
      "pointer-coarse:translate-x-0",
      "pointer-coarse:bottom-[8.5rem]",
      "sm:pointer-coarse:bottom-[4.75rem]"
    );
  });

  it("goes once the board has something on it", () => {
    const { container } = render(<EmptyCanvasHint objectCount={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});
