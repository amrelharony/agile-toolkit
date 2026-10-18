import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import {
  CANVAS_BOARD_ATTR,
  CANVAS_ZOOM_CHORDS,
  controlOwnsKey,
  defaultCanvasShortcuts,
  makeShortcutHandler,
} from "@/lib/whiteboard/keyboard";
import { describeSelection } from "@/lib/whiteboard/search";
import { TableObject } from "@/app/(tools)/canvas/components/objects/table-object";
import {
  ZOOM_STEP,
  useKeyboardZoomActions,
  zoomStep,
} from "@/app/(tools)/canvas/hooks/use-pan-zoom-controls";
import { useFocusBoardOnMount } from "@/app/(tools)/canvas/hooks/use-contextual-shortcuts";
import { ToolbarLeft } from "@/app/(tools)/canvas/components/toolbar-left";
import { useCanvasStore, type CanvasTool } from "@/app/(tools)/canvas/use-canvas-store";
import { stickyFixture, tableFixture } from "./object-fixtures";

/**
 * WCAG 2.1.4 / 2.1.1 regressions for the whiteboard keyboard model:
 * single-key shortcuts only fire while focus is on the board, shortcuts
 * stand down for keys a focused control uses itself, the advertised zoom
 * chords and H (Pan) actually work, Tab-selection is announced, tables
 * have a keyboard route into cell editing, and the board keeps focus for
 * mouse users (on load and after a toolbar click) so those keys work.
 */

function dom() {
  const viewport = document.createElement("div");
  viewport.tabIndex = 0;
  const inner = document.createElement("button");
  viewport.append(inner);
  const outside = document.createElement("button");
  document.body.append(viewport, outside);
  return { viewport, inner, outside };
}

function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("makeShortcutHandler scope", () => {
  function setup() {
    const { viewport, inner, outside } = dom();
    const setTool = vi.fn();
    const deleteSelected = vi.fn();
    const cancel = vi.fn();
    const undo = vi.fn();
    const handler = makeShortcutHandler(
      defaultCanvasShortcuts({ setTool, deleteSelected, cancel, undo }),
      { scope: () => viewport }
    );
    window.addEventListener("keydown", handler);
    const cleanup = () => window.removeEventListener("keydown", handler);
    return { viewport, inner, outside, setTool, deleteSelected, cancel, undo, cleanup };
  }

  it("fires tool letters and Delete only while focus is inside the board", () => {
    const { viewport, outside, setTool, deleteSelected, cleanup } = setup();
    press(viewport, "n");
    expect(setTool).toHaveBeenCalledWith("sticky");
    press(outside, "n");
    press(document.body, "r");
    press(outside, "Delete");
    expect(setTool).toHaveBeenCalledTimes(1);
    expect(deleteSelected).not.toHaveBeenCalled();
    press(viewport, "Delete");
    expect(deleteSelected).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("keeps Escape and modifier chords window-wide", () => {
    const { outside, cancel, undo, cleanup } = setup();
    press(outside, "Escape");
    press(outside, "z", { ctrlKey: true });
    press(outside, "z", { metaKey: true });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalled();
    cleanup();
  });

  it("binds H to the Pan tool the toolbar advertises", () => {
    const { viewport, setTool, cleanup } = setup();
    press(viewport, "h");
    expect(setTool).toHaveBeenCalledWith("hand");
    cleanup();
  });
});

describe("zoom chords", () => {
  // jsdom reports a non-Mac platform, so Mod = Ctrl.
  function setup(actions: Parameters<typeof defaultCanvasShortcuts>[0]) {
    const { viewport, outside } = dom();
    const handler = makeShortcutHandler(defaultCanvasShortcuts(actions), {
      scope: () => viewport,
      scopedChords: CANVAS_ZOOM_CHORDS,
    });
    window.addEventListener("keydown", handler);
    const cleanup = () => window.removeEventListener("keydown", handler);
    return { viewport, outside, cleanup };
  }

  it("zooms the board on Ctrl + = / - / 0 / 1 while it has focus", () => {
    const zoomIn = vi.fn();
    const zoomOut = vi.fn();
    const resetZoom = vi.fn();
    const fitToContent = vi.fn();
    const { viewport, cleanup } = setup({ zoomIn, zoomOut, resetZoom, fitToContent });
    expect(press(viewport, "=", { ctrlKey: true }).defaultPrevented).toBe(true);
    press(viewport, "-", { ctrlKey: true });
    press(viewport, "0", { ctrlKey: true });
    press(viewport, "1", { ctrlKey: true });
    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).toHaveBeenCalledTimes(1);
    expect(resetZoom).toHaveBeenCalledTimes(1);
    expect(fitToContent).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("leaves them to the browser's page zoom outside the board", () => {
    const zoomIn = vi.fn();
    const { outside, cleanup } = setup({ zoomIn });
    const e = press(outside, "=", { ctrlKey: true });
    expect(zoomIn).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    cleanup();
  });

  it("doesn't swallow a chord whose action isn't wired", () => {
    const zoomIn = vi.fn();
    const { viewport, cleanup } = setup({ zoomIn });
    // zoomOut / resetZoom were bound to no-ops and still preventDefault()ed.
    expect(press(viewport, "-", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(viewport, "0", { ctrlKey: true }).defaultPrevented).toBe(false);
    cleanup();
  });
});

describe("zoomStep", () => {
  it("zooms about the viewport centre by one step each way", () => {
    const size = { w: 800, h: 600 };
    const cam = { x: 0, y: 0, zoom: 1 };
    const zin = zoomStep(cam, size, 1);
    expect(zin.zoom).toBeCloseTo(ZOOM_STEP);
    // The world point under the centre stays put.
    expect(zin.x + 400 / zin.zoom).toBeCloseTo(400);
    expect(zin.y + 300 / zin.zoom).toBeCloseTo(300);
    expect(zoomStep(zin, size, -1).zoom).toBeCloseTo(1);
  });
});

describe("useKeyboardZoomActions", () => {
  it("drives the camera with the live camera, size and objects", () => {
    const setCamera = vi.fn();
    const objectsRef = { current: [{ x: 0, y: 0, w: 100, h: 100 }] };
    const { result, rerender } = renderHook(
      ({ zoom }) =>
        useKeyboardZoomActions({
          camera: { x: 0, y: 0, zoom },
          setCamera,
          size: { w: 800, h: 600 },
          objectsRef,
        }),
      { initialProps: { zoom: 1 } }
    );
    const first = result.current;
    rerender({ zoom: 2 });
    // Stable identity, so the shortcut listener doesn't rebind per camera tick…
    expect(result.current).toBe(first);
    // …but it reads the current camera.
    result.current.zoomIn();
    expect(setCamera.mock.calls[0][0].zoom).toBeCloseTo(2 * ZOOM_STEP);
    result.current.resetZoom();
    expect(setCamera.mock.calls[1][0]).toEqual({ x: 0, y: 0, zoom: 1 });
    result.current.fitToContent();
    expect(setCamera).toHaveBeenCalledTimes(3);
    expect(setCamera.mock.calls[2][0].zoom).toBeGreaterThan(1);
  });
});

describe("controlOwnsKey", () => {
  it("leaves Space / Enter to buttons and arrows to arrow-key widgets", () => {
    const { viewport, inner } = dom();
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    const select = document.createElement("select");
    document.body.append(slider, select);

    expect(controlOwnsKey(inner, " ")).toBe(true);
    expect(controlOwnsKey(inner, "Enter")).toBe(true);
    expect(controlOwnsKey(inner, "ArrowLeft")).toBe(false);
    expect(controlOwnsKey(slider, "ArrowLeft")).toBe(true);
    expect(controlOwnsKey(select, "ArrowDown")).toBe(true);
    // The board surface itself owns none of them.
    expect(controlOwnsKey(viewport, " ")).toBe(false);
    expect(controlOwnsKey(viewport, "ArrowUp")).toBe(false);
  });

  it("treats every key in a text field as the field's", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(controlOwnsKey(input, "ArrowLeft")).toBe(true);
    expect(controlOwnsKey(input, " ")).toBe(true);
  });
});

describe("describeSelection", () => {
  it("names the kind and text of a single selected object", () => {
    expect(describeSelection([stickyFixture({ content: "<p>Ship it</p>" })])).toBe(
      "Sticky note: Ship it, selected"
    );
    expect(describeSelection([stickyFixture({ content: "Blocked", locked: true })])).toBe(
      "Sticky note: Blocked, locked, selected"
    );
  });

  it("counts multi-selections and is silent when nothing is selected", () => {
    expect(describeSelection([stickyFixture(), stickyFixture()])).toBe("2 objects selected");
    expect(describeSelection([])).toBe("");
  });
});

describe("TableObject keyboard edit route", () => {
  it("opens the first cell when the board flags it as editing, and hands back on Esc", () => {
    const onEditEnd = vi.fn();
    const table = tableFixture();
    const { rerender } = render(
      <TableObject object={table} selected readOnly={false} onMutate={vi.fn()} editing={false} />
    );
    expect(screen.queryByRole("textbox")).toBeNull();

    rerender(
      <TableObject
        object={table}
        selected
        readOnly={false}
        onMutate={vi.fn()}
        editing
        onEditEnd={onEditEnd}
      />
    );
    const cell = screen.getByRole("textbox", { name: "Header, column 1" });
    expect(document.activeElement).toBe(cell);
    expect(onEditEnd).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(cell, { key: "Escape" });
    });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onEditEnd).toHaveBeenCalledTimes(1);
  });

  it("hands straight back when the table is locked", () => {
    const onEditEnd = vi.fn();
    render(
      <TableObject
        object={tableFixture({ locked: true })}
        selected
        readOnly={false}
        onMutate={vi.fn()}
        editing
        onEditEnd={onEditEnd}
      />
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onEditEnd).toHaveBeenCalledTimes(1);
  });
});

describe("board focus for mouse users", () => {
  function board() {
    const el = document.createElement("div");
    el.tabIndex = 0;
    el.setAttribute(CANVAS_BOARD_ATTR, "");
    document.body.append(el);
    return el;
  }

  /** Mouse click as a browser does it: mousedown moves focus to the
   *  button unless it was default-prevented (jsdom doesn't do this). */
  function mouseClick(el: HTMLElement) {
    if (fireEvent.mouseDown(el)) el.focus();
    fireEvent.mouseUp(el);
    fireEvent.click(el);
  }

  afterEach(() => {
    act(() => useCanvasStore.setState({ tool: "select" }));
  });

  it("focuses the board on mount when nothing else has focus", () => {
    const el = board();
    expect(document.activeElement).toBe(document.body);
    renderHook(() => useFocusBoardOnMount({ current: el }));
    expect(document.activeElement).toBe(el);
  });

  it("never takes focus from something that already has it", () => {
    const el = board();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    renderHook(() => useFocusBoardOnMount({ current: el }));
    expect(document.activeElement).toBe(input);
  });

  it("tool buttons don't take focus on mousedown", () => {
    board();
    render(<ToolbarLeft />);
    const sticky = screen.getByRole("button", { name: "Sticky" });
    // fireEvent returns false when the handler called preventDefault().
    expect(fireEvent.mouseDown(sticky)).toBe(false);
    // The popover trigger still takes focus normally.
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Diagram shapes" }))).toBe(true);
  });

  it("keeps letter shortcuts working after a tool is picked with the mouse", () => {
    const el = board();
    el.focus();
    const handler = makeShortcutHandler(
      defaultCanvasShortcuts({
        setTool: (t) => useCanvasStore.getState().setTool(t as CanvasTool),
      }),
      { scope: () => el }
    );
    window.addEventListener("keydown", handler);
    render(<ToolbarLeft />);

    mouseClick(screen.getByRole("button", { name: "Rectangle" }));
    expect(useCanvasStore.getState().tool).toBe("rect");
    expect(document.activeElement).toBe(el);

    press(document.activeElement as Element, "n");
    expect(useCanvasStore.getState().tool).toBe("sticky");
    window.removeEventListener("keydown", handler);
  });

  it("brings focus back to the board from a field outside it", () => {
    const el = board();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    render(<ToolbarLeft />);
    mouseClick(screen.getByRole("button", { name: "Pen" }));
    expect(document.activeElement).toBe(el);
  });
});
