import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The board's zoom controls on touch screens.
 *
 * - Mobile audit #69: Amr stands in the screen's bottom-right corner, over
 *   the zoom bar's Fit to content when the board's bottom edge is on
 *   screen. On touch the controls move bottom-left, past the tool rail,
 *   and the bar is tightened so Fit stops short of him even at 360 px.
 * - Mobile audit #23: the touch row carries the page's full-screen board
 *   switch (the board is capped below the screen's height otherwise).
 */

import {
  ZoomControls,
  ZOOM_CONTROLS_TOUCH_LEFT,
} from "@/app/(tools)/canvas/components/zoom-controls";

function stackOf(zoomBar: HTMLElement) {
  return zoomBar.parentElement as HTMLElement;
}

describe("ZoomControls on touch", () => {
  it("moves bottom-left, past the tool rail, on touch only", () => {
    render(<ZoomControls onFit={() => {}} />);
    const stack = stackOf(screen.getByRole("toolbar", { name: "Zoom controls" }));
    // Mouse: unchanged bottom-right corner.
    expect(stack).toHaveClass("absolute", "right-3", "bottom-3");
    // Touch: out of Amr's corner, 72 px in (the rail ends 59 px in).
    expect(ZOOM_CONTROLS_TOUCH_LEFT).toBe("pointer-coarse:right-auto pointer-coarse:left-[4.5rem]");
    expect(stack).toHaveClass("pointer-coarse:right-auto", "pointer-coarse:left-[4.5rem]");
  });

  it("tightens the zoom bar on touch so Fit stops short of Amr", () => {
    render(<ZoomControls onFit={() => {}} />);
    const bar = screen.getByRole("toolbar", { name: "Zoom controls" });
    expect(bar).toHaveClass("gap-1", "px-2", "pointer-coarse:gap-0.5", "pointer-coarse:px-1");
    // 44 px targets: the % reset joins the icon buttons.
    const reset = within(bar).getByRole("button", { name: /Reset zoom/ });
    expect(reset).toHaveClass(
      "min-w-[50px]",
      "pointer-coarse:min-w-11",
      "pointer-coarse:min-h-11",
      "pointer-coarse:px-1"
    );
    for (const name of ["Zoom out", "Zoom in", "Fit to content"]) {
      expect(within(bar).getByRole("button", { name })).toHaveClass("min-touch-coarse");
    }
    // The divider goes on touch (mouse keeps it).
    const fit = within(bar).getByRole("button", { name: "Fit to content" });
    expect(fit.previousElementSibling).toHaveClass("w-px", "pointer-coarse:hidden");
    // Fit stays the bar's last control (same order for every pointer).
    expect(bar.lastElementChild).toBe(fit);
  });

  it("offers the full-screen board in the touch row when the page has one", () => {
    const toggle = vi.fn();
    const { rerender } = render(
      <ZoomControls onFit={() => {}} fillScreen={{ on: false, toggle }} />
    );
    const button = screen.getByRole("button", { name: "Full-screen board" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Full screen");
    expect(button).toHaveClass("w-11", "h-11");
    // Touch only: its row renders nothing for a mouse.
    const row = button.parentElement!.parentElement!;
    expect(row).toHaveClass("hidden", "pointer-coarse:flex");
    expect(row.parentElement).toBe(stackOf(screen.getByRole("toolbar", { name: "Zoom controls" })));
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);

    rerender(<ZoomControls onFit={() => {}} fillScreen={{ on: true, toggle }} />);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Exit full screen");
  });

  it("has no full-screen switch where the board already fills its page", () => {
    // The guest board passes no fillScreen (and has no history here).
    render(<ZoomControls />);
    expect(screen.queryByRole("button", { name: "Full-screen board" })).not.toBeInTheDocument();
    const stack = stackOf(screen.getByRole("toolbar", { name: "Zoom controls" }));
    expect(stack.children).toHaveLength(1);
  });
});
