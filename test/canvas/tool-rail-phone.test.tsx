import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { setScroll } from "./scroll-metrics";

/**
 * The canvas tool rail on phones (mobile audit #19, #71). The board
 * toolbar shared its top-left corner and covered Select; now, on /canvas,
 * the rail starts under that toolbar below `sm`. The 22-tool rail scrolls
 * with no visible cue; now the end that still hides tools fades on touch.
 * Its diagram picker is portalled out of the rail, so it takes focus when
 * it opens and stays on screen next to a low Diagrams button.
 */

import { ToolbarLeft } from "@/app/(tools)/canvas/components/toolbar-left";
import { clampMenuTop } from "@/app/(tools)/canvas/components/diagram-shape-picker";
import { DIAGRAM_SHAPE_KINDS } from "@/app/(tools)/canvas/components/objects/diagram-shape";
import { useCanvasStore } from "@/app/(tools)/canvas/use-canvas-store";
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
    expect(picker.parentElement?.parentElement).toBe(document.body);
  });
});

describe("ToolbarLeft diagram picker focus", () => {
  const initialPick = useCanvasStore.getState().pickedDiagramShape;
  afterEach(() => {
    useCanvasStore.setState({ pickedDiagramShape: initialPick, tool: "select" });
  });

  const openPicker = () => {
    const trigger = screen.getByRole("button", { name: "Diagram shapes" });
    trigger.focus();
    fireEvent.click(trigger);
    return trigger;
  };

  it("moves focus onto the picked shape when it opens (it sits at the end of <body>)", () => {
    const [kind, def] = Object.entries(DIAGRAM_SHAPE_KINDS)[1];
    useCanvasStore.setState({ pickedDiagramShape: kind });
    render(<ToolbarLeft clearBoardBar />);
    openPicker();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: def.label }));
  });

  it("falls back to the first shape when the picked one isn't listed", () => {
    useCanvasStore.setState({ pickedDiagramShape: "" });
    render(<ToolbarLeft clearBoardBar />);
    openPicker();
    const items = within(screen.getByRole("menu", { name: "Diagram shape picker" })).getAllByRole(
      "menuitem"
    );
    expect(document.activeElement).toBe(items[0]);
  });

  it("gives focus back to the Diagrams button on Escape", () => {
    render(<ToolbarLeft clearBoardBar />);
    const trigger = openPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Diagram shape picker" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("gives focus back to the Diagrams button after a shape is picked", () => {
    render(<ToolbarLeft clearBoardBar />);
    const trigger = openPicker();
    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.queryByRole("menu", { name: "Diagram shape picker" })).toBeNull();
    expect(useCanvasStore.getState().tool).toBe("diagramShape");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a press outside, which then takes focus as usual", () => {
    render(
      <>
        <ToolbarLeft clearBoardBar />
        <button type="button">elsewhere</button>
      </>
    );
    const trigger = openPicker();
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    // The press lands while the menu has focus; the browser then moves
    // focus to what was pressed (jsdom doesn't, so do it by hand).
    fireEvent.pointerDown(elsewhere);
    expect(screen.queryByRole("menu", { name: "Diagram shape picker" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    elsewhere.focus();
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("diagram picker placement", () => {
  it("moves up to stay on screen when the Diagrams button is near the bottom", () => {
    // 360x640: a 310 px menu beside a button at y=560 would end at 870.
    expect(clampMenuTop(560, 310, 640)).toBe(640 - 310 - 8);
    // Room below: level with the button.
    expect(clampMenuTop(120, 310, 640)).toBe(120);
    // Taller than the screen (it scrolls inside): pinned to the top gap.
    expect(clampMenuTop(300, 700, 640)).toBe(8);
  });

  it("applies the clamp to the open picker", () => {
    const innerHeight = window.innerHeight;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const menu = this.getAttribute("role") === "menu";
        return {
          top: menu ? 0 : 560,
          bottom: menu ? 310 : 600,
          left: 8,
          right: 58,
          width: 50,
          height: menu ? 310 : 40,
          x: 8,
          y: 560,
          toJSON: () => ({}),
        } as DOMRect;
      });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
    try {
      render(<ToolbarLeft clearBoardBar />);
      fireEvent.click(screen.getByRole("button", { name: "Diagram shapes" }));
      const picker = screen.getByRole("menu", { name: "Diagram shape picker" });
      expect(picker.style.top).toBe(`${640 - 310 - 8}px`);
      expect(picker.style.left).toBe(`${58 + 8}px`);
    } finally {
      rect.mockRestore();
      Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight });
    }
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
