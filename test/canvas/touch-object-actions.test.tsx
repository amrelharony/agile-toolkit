import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { stickyFixture } from "./object-fixtures";

/**
 * Phone object actions (mobile audit #1): Delete, Duplicate, Undo and Redo
 * had keyboard shortcuts only. Touch screens now get 44 px buttons — on
 * the selection bar and above the zoom bar — that call the very handlers
 * the keys run, with the same read-only and mid-gesture guards.
 */

// The pinch recognisers aren't under test here.
vi.mock("@use-gesture/react", () => ({ useGesture: () => {} }));

import {
  useCanvasShortcuts,
  type CanvasObjectActions,
} from "@/app/(tools)/canvas/hooks/use-canvas-shortcuts";
import { PropertyPanel } from "@/app/(tools)/canvas/components/property-panel";
import { ZoomControls } from "@/app/(tools)/canvas/components/zoom-controls";
import { GestureHarness, touchPointer } from "./touch-harness";

afterEach(() => {
  vi.useRealTimers();
});

const BOARD = "board-1";

function shortcutParams(
  overrides: Partial<Parameters<typeof useCanvasShortcuts>[0]> = {}
): Parameters<typeof useCanvasShortcuts>[0] {
  const objects: WhiteboardObject[] = [stickyFixture({ id: "s1", boardId: BOARD })];
  const noop = () => {};
  return {
    objectsRef: { current: objects },
    objectsByIdRef: { current: new Map(objects.map((o) => [o.id, o])) },
    topZRef: { current: 10 },
    lassoRafRef: { current: null },
    lassoPointsRef: { current: null },
    lastLassoWorldRef: { current: null },
    wetInkApiRef: { current: null },
    drag: null,
    resize: null,
    rotation: null,
    marquee: null,
    drawing: null,
    pendingConnectorFromId: null,
    selection: ["s1"],
    setSelection: vi.fn(),
    clearSelection: vi.fn(),
    setDrag: noop,
    setResize: noop,
    setRotation: noop,
    setMarquee: noop,
    setDrawing: noop,
    setPendingConnectorFromId: noop,
    setTool: noop,
    boardId: BOARD,
    removeMany: vi.fn(),
    upsertMany: vi.fn(),
    pushSnapshot: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    log: vi.fn(),
    logActivity: noop,
    readOnly: false,
    viewportRef: { current: document.body },
    zoomActions: { zoomIn: noop, zoomOut: noop, resetZoom: noop, fitToContent: noop },
    ...overrides,
  };
}

describe("useCanvasShortcuts object actions", () => {
  it("are the keymap's own handlers", () => {
    const params = shortcutParams();
    const { result } = renderHook(() => useCanvasShortcuts(params));
    act(() => result.current.deleteSelected());
    expect(params.removeMany).toHaveBeenCalledWith(["s1"]);
    // The Delete key runs the very same path.
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(params.removeMany).toHaveBeenCalledTimes(2);
    expect(params.removeMany).toHaveBeenLastCalledWith(["s1"]);

    act(() => result.current.duplicate());
    const dup = vi.mocked(params.upsertMany).mock.calls.at(-1)?.[0] ?? [];
    expect(dup).toHaveLength(1);
    expect(dup[0].id).not.toBe("s1");
    expect(params.setSelection).toHaveBeenLastCalledWith([dup[0].id]);

    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(params.undo).toHaveBeenCalledTimes(1);
    expect(params.redo).toHaveBeenCalledTimes(1);
  });

  it("keep one identity while the handlers behind them change", () => {
    let params = shortcutParams();
    const { result, rerender } = renderHook(() => useCanvasShortcuts(params));
    const first = result.current;
    params = shortcutParams({ selection: [] });
    rerender();
    expect(result.current).toBe(first);
    // ...and call the CURRENT handlers: nothing selected, nothing deleted.
    act(() => result.current.deleteSelected());
    expect(params.removeMany).not.toHaveBeenCalled();
  });

  it("keep the keys' guards: no edits when read-only, no undo mid-drag", () => {
    const readOnly = shortcutParams({ readOnly: true });
    const ro = renderHook(() => useCanvasShortcuts(readOnly));
    act(() => ro.result.current.deleteSelected());
    expect(readOnly.removeMany).not.toHaveBeenCalled();
    ro.unmount();

    const dragging = shortcutParams({ drag: { startWorld: { x: 0, y: 0 } } });
    const dr = renderHook(() => useCanvasShortcuts(dragging));
    act(() => dr.result.current.undo());
    expect(dragging.undo).not.toHaveBeenCalled();
    dr.unmount();
  });
});

describe("PropertyPanel object actions", () => {
  const panel = (objectActions?: Pick<CanvasObjectActions, "duplicate" | "deleteSelected">) =>
    render(
      <PropertyPanel
        selection={[stickyFixture()]}
        selectionBbox={{ x: 100, y: 200, w: 200, h: 160 }}
        camera={{ x: 0, y: 0, zoom: 1 }}
        viewportHeight={600}
        onPatch={vi.fn()}
        objectActions={objectActions}
      />
    );

  it("ends the selection bar with Duplicate and Delete for touch", () => {
    const actions = { duplicate: vi.fn(), deleteSelected: vi.fn() };
    panel(actions);
    const group = screen.getByRole("group", { name: "Object actions" });
    // Touch only, and pinned in view when the bar scrolls sideways.
    expect(group).toHaveClass("hidden", "pointer-coarse:flex", "sticky", "right-0");
    const duplicate = within(group).getByRole("button", { name: "Duplicate selection" });
    const remove = within(group).getByRole("button", { name: "Delete selection" });
    for (const b of [duplicate, remove]) expect(b).toHaveClass("w-11", "h-11");
    fireEvent.click(duplicate);
    fireEvent.click(remove);
    expect(actions.duplicate).toHaveBeenCalledTimes(1);
    expect(actions.deleteSelected).toHaveBeenCalledTimes(1);
    // Last in the bar.
    const bar = screen.getByRole("toolbar", { name: "Object properties" });
    expect(bar.lastElementChild).toBe(group);
  });

  it("sits higher on touch, clear of the rotation handle", () => {
    // The bbox top is at y 200. With a mouse the bar keeps its 56 px
    // slot; on touch its 44 px buttons make it ~50 px tall, and with 56
    // the rotation handle (24 px above the object, over the bar in z)
    // landed on the middle of it.
    const props = {
      selection: [stickyFixture()],
      selectionBbox: { x: 100, y: 200, w: 200, h: 160 },
      camera: { x: 0, y: 0, zoom: 1 },
      viewportHeight: 600,
      onPatch: vi.fn(),
    };
    const { rerender } = render(<PropertyPanel {...props} />);
    const bar = screen.getByRole("toolbar", { name: "Object properties" });
    expect(bar.style.top).toBe("144px");
    rerender(<PropertyPanel {...props} isCoarse />);
    expect(bar.style.top).toBe("116px");
    // No room above on touch: below the selection instead.
    rerender(
      <PropertyPanel {...props} isCoarse selectionBbox={{ x: 100, y: 60, w: 200, h: 160 }} />
    );
    expect(bar.style.top).toBe(`${60 + 160 + 8}px`);
  });

  it("has no object actions without handlers (read-only views)", () => {
    panel(undefined);
    expect(screen.queryByRole("group", { name: "Object actions" })).not.toBeInTheDocument();
  });
});

function ShortcutsHarness({ params }: { params: Parameters<typeof useCanvasShortcuts>[0] }) {
  useCanvasShortcuts(params);
  return null;
}

describe("ZoomControls Undo / Redo", () => {
  it("adds touch Undo / Redo above the zoom bar while an editable board is open", () => {
    const params = shortcutParams();
    const { unmount } = render(
      <>
        <ZoomControls />
        <ShortcutsHarness params={params} />
      </>
    );
    const bar = screen.getByRole("toolbar", { name: "Undo and redo" });
    expect(bar).toHaveClass("hidden", "pointer-coarse:flex");
    const undo = within(bar).getByRole("button", { name: "Undo" });
    const redo = within(bar).getByRole("button", { name: "Redo" });
    for (const b of [undo, redo]) expect(b).toHaveClass("w-11", "h-11");
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(params.undo).toHaveBeenCalledTimes(1);
    expect(params.redo).toHaveBeenCalledTimes(1);
    // The zoom bar itself is untouched.
    const zoomBar = screen.getByRole("toolbar", { name: "Zoom controls" });
    // Stacked above the zoom bar on phones; beside it from sm up, where
    // the mini-map sits right above the zoom bar.
    const wrapper = zoomBar.parentElement!;
    expect(wrapper).toBe(bar.parentElement);
    expect(wrapper).toHaveClass("flex-col", "sm:flex-row", "sm:items-end");
    expect(wrapper.firstElementChild).toBe(bar);
    unmount();

    // Board closed: no stale buttons.
    render(<ZoomControls />);
    expect(screen.queryByRole("toolbar", { name: "Undo and redo" })).not.toBeInTheDocument();
  });

  it("sits on the guest board, not above it", () => {
    // ZoomControls is `absolute right-3 bottom-3`: inside a 0x0 box at
    // the board's top-right it ended above the board, and the Undo / Redo
    // bar stacked over it was off-screen for guest editors.
    const src = readFileSync(
      join(process.cwd(), "src/app/(guest)/guest/canvas/[boardId]/guest-canvas-client.tsx"),
      "utf8"
    );
    expect(src).toMatch(
      /<div className="pointer-events-none absolute inset-0 z-overlay">\s*<ZoomControls \/>/
    );
  });

  it("has no Undo / Redo on a read-only board", () => {
    render(
      <>
        <ZoomControls />
        <ShortcutsHarness params={shortcutParams({ readOnly: true })} />
      </>
    );
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});

describe("board controls aren't board gestures", () => {
  it("two quick taps on Duplicate don't also fit the board, nor does holding it", () => {
    vi.useFakeTimers();
    const setCamera = vi.fn();
    render(<GestureHarness setCamera={setCamera} />);
    const button = screen.getByRole("button", { name: "Duplicate selection" });
    const menus: Event[] = [];
    screen.getByTestId("viewport").addEventListener("contextmenu", (e) => menus.push(e));
    button.dispatchEvent(touchPointer("pointerdown"));
    vi.advanceTimersByTime(600);
    button.dispatchEvent(touchPointer("pointerup"));
    for (let i = 0; i < 2; i++) {
      button.dispatchEvent(touchPointer("pointerdown"));
      button.dispatchEvent(touchPointer("pointerup"));
    }
    expect(menus).toEqual([]);
    expect(setCamera).not.toHaveBeenCalled();
  });

  it("a double-tap on the board itself still fits it", () => {
    const setCamera = vi.fn();
    render(<GestureHarness setCamera={setCamera} />);
    const item = screen.getByTestId("item");
    for (let i = 0; i < 2; i++) {
      item.dispatchEvent(touchPointer("pointerdown"));
      item.dispatchEvent(touchPointer("pointerup"));
    }
    expect(setCamera).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1 });
  });
});
