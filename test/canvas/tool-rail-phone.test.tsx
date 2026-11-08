import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { setScroll } from "./scroll-metrics";

/**
 * The canvas tool rail on phones (mobile audit #19, #71). The board
 * toolbar shared its top-left corner and covered Select; now, on /canvas,
 * the rail starts under that toolbar below `sm`. The 22-tool rail scrolls
 * with no visible cue; now the end that still hides tools fades on touch.
 */

import { ToolbarLeft } from "@/app/(tools)/canvas/components/toolbar-left";
import {
  COARSE_SCROLL_FADE,
  readScrollEdges,
  scrollFadeMask,
} from "@/app/(tools)/canvas/hooks/use-scroll-edges";

const rail = () => screen.getByRole("toolbar", { name: "Canvas tools" });
const fade = (el: HTMLElement) => el.style.getPropertyValue("--scroll-fade");

describe("ToolbarLeft position", () => {
  it("starts under the board toolbar below sm on /canvas", () => {
    render(<ToolbarLeft clearBoardBar />);
    expect(rail()).toHaveClass("top-[4.25rem]", "sm:top-3");
    expect(rail()).not.toHaveClass("top-2");
  });

  it("keeps its top-2 corner where there is no board toolbar (guest board)", () => {
    render(<ToolbarLeft />);
    expect(rail()).toHaveClass("top-2", "sm:top-3");
    expect(rail()).not.toHaveClass("top-[4.25rem]");
  });
});

describe("ToolbarLeft scroll cue", () => {
  it("fades the end that still hides tools, on touch only", () => {
    render(<ToolbarLeft clearBoardBar />);
    const el = rail();
    expect(el).toHaveClass(...COARSE_SCROLL_FADE.split(" "));
    expect(fade(el)).toBe("none");

    // 21 tools in a 420 px rail: more below.
    setScroll(el, { scrollTop: 0, clientHeight: 420, scrollHeight: 958 });
    fireEvent.scroll(el);
    expect(fade(el)).toBe(scrollFadeMask("y", { before: false, after: true }));

    // Partway: both ends.
    setScroll(el, { scrollTop: 200 });
    fireEvent.scroll(el);
    expect(fade(el)).toBe(scrollFadeMask("y", { before: true, after: true }));

    // At the end: only the top.
    setScroll(el, { scrollTop: 538 });
    fireEvent.scroll(el);
    expect(fade(el)).toBe(scrollFadeMask("y", { before: true, after: false }));
  });

  it("opens the diagram picker outside the rail, so the fade can't clip it", () => {
    render(<ToolbarLeft clearBoardBar />);
    fireEvent.click(screen.getByRole("button", { name: "Diagram shapes" }));
    const picker = screen.getByRole("menu", { name: "Diagram shape picker" });
    expect(rail().contains(picker)).toBe(false);
    expect(picker.parentElement).toBe(document.body);
  });
});

describe("scroll fade helpers", () => {
  it("reads which ends hide content", () => {
    const el = document.createElement("div");
    setScroll(el, { scrollLeft: 0, clientWidth: 316, scrollWidth: 527 });
    expect(readScrollEdges(el, "x")).toEqual({ before: false, after: true });
    setScroll(el, { scrollLeft: 211 });
    expect(readScrollEdges(el, "x")).toEqual({ before: true, after: false });
    setScroll(el, { scrollWidth: 316, scrollLeft: 0 });
    expect(readScrollEdges(el, "x")).toEqual({ before: false, after: false });
  });

  it("masks only the hidden ends", () => {
    expect(scrollFadeMask("x", { before: false, after: false })).toBeUndefined();
    expect(scrollFadeMask("x", { before: false, after: true })).toBe(
      "linear-gradient(to right, black 0, black calc(100% - 24px), transparent 100%)"
    );
    expect(scrollFadeMask("y", { before: true, after: false })).toBe(
      "linear-gradient(to bottom, transparent 0, black 24px, black 100%)"
    );
  });
});
