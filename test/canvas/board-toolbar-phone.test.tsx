import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { setScroll } from "./scroll-metrics";

/**
 * The board toolbar on phones (mobile audit #19, #20, #66, #71). From
 * `sm` up it keeps clear of the tool rail and the corner mic; below `sm`
 * it can carry the mic as a pinned last item; its board picker controls
 * are 44 px on touch with a pencil for rename; its strip fades at the end
 * that still hides controls.
 */

vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: vi.fn() }),
}));

import { ToolbarTop } from "@/app/(tools)/canvas/components/toolbar-top";
import { COARSE_SCROLL_FADE, scrollFadeMask } from "@/app/(tools)/canvas/hooks/use-scroll-edges";
import { useCanvasStore } from "@/app/(tools)/canvas/use-canvas-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const BOARD = "wb_toolbar_test";

beforeEach(() => {
  const now = new Date().toISOString();
  useWorkspaceStore
    .getState()
    .upsertWhiteboard({ id: BOARD, name: "My first board", createdAt: now, updatedAt: now });
  useCanvasStore.getState().setActiveBoard(BOARD);
});
afterEach(() => {
  useWorkspaceStore.getState().removeWhiteboard(BOARD);
  useCanvasStore.getState().setActiveBoard(null);
});

/** The scrolling strip of controls, and the bar framing it. */
const strip = () =>
  screen.getByRole("combobox", { name: "Active board" }).closest(".overflow-x-auto") as HTMLElement;
const bar = () => strip().parentElement as HTMLElement;

describe("ToolbarTop layout", () => {
  it("keeps clear of the rail and the corner mic from sm up, centred without a transform", () => {
    render(<ToolbarTop />);
    expect(bar()).toHaveClass(
      "inset-x-0",
      "mx-auto",
      "w-max",
      "max-w-[calc(100%-1rem)]",
      "sm:max-w-[calc(100%-9rem)]"
    );
    // A transform would trap the mic's fixed "Listening" pill in the bar.
    expect(bar().className).not.toMatch(/translate/);
    // Nothing pinned at the end without a trailing item.
    expect(bar().children).toHaveLength(1);
  });

  it("pins a trailing item (the phone mic) outside the scroll strip", () => {
    render(<ToolbarTop trailing={<button type="button">Start voice input</button>} />);
    const mic = screen.getByRole("button", { name: "Start voice input" });
    expect(bar().contains(mic)).toBe(true);
    expect(strip().contains(mic)).toBe(false);
    expect(bar().lastElementChild?.contains(mic)).toBe(true);
  });
});

describe("ToolbarTop board picker", () => {
  it("gives the board picker touch sizes and a pencil for rename", () => {
    render(<ToolbarTop />);
    const select = screen.getByRole("combobox", { name: "Active board" });
    expect(select).toHaveClass("pointer-coarse:min-h-11", "max-w-[160px]");
    expect(select.className).not.toMatch(/max-w-\[120px\]/);

    const rename = screen.getByRole("button", { name: "Rename board My first board" });
    expect(rename).toHaveClass("min-touch-coarse", "w-7", "h-7");
    expect(rename).not.toHaveTextContent(/edit/i);
    expect(rename.querySelector("svg")).not.toBeNull();

    expect(screen.getByRole("button", { name: "New" })).toHaveClass("min-touch-coarse");
    expect(screen.getByRole("button", { name: "Enter presentation mode" })).toHaveClass(
      "min-touch-coarse"
    );

    fireEvent.click(rename);
    expect(screen.getByRole("textbox", { name: "Board name" })).toHaveValue("My first board");
  });
});

describe("ToolbarTop scroll cue", () => {
  it("fades the strip's hidden end on touch", () => {
    render(<ToolbarTop />);
    const s = strip();
    expect(s).toHaveClass(...COARSE_SCROLL_FADE.split(" "));
    expect(s.style.getPropertyValue("--scroll-fade")).toBe("none");
    setScroll(s, { scrollLeft: 0, clientWidth: 316, scrollWidth: 527 });
    fireEvent.scroll(s);
    expect(s.style.getPropertyValue("--scroll-fade")).toBe(
      scrollFadeMask("x", { before: false, after: true })
    );
  });
});
