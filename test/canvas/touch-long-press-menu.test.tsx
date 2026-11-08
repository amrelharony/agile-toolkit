import { useRef } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The long-press menu (mobile audit #1): a held finger dispatched a
 * `contextmenu` nothing listened for. It's now marked as a long-press and
 * opens a menu at the touch point whose items call the board's shortcut
 * handlers. A mouse right-click still gets the browser's own menu.
 */

// The pinch recognisers aren't under test here.
vi.mock("@use-gesture/react", () => ({ useGesture: () => {} }));

import {
  dispatchCanvasLongPress,
  isCanvasLongPress,
} from "@/app/(tools)/canvas/hooks/use-canvas-touch-gestures";
import type { CanvasObjectActions } from "@/app/(tools)/canvas/hooks/use-canvas-shortcuts";
import { CanvasObjectMenu } from "@/app/(tools)/canvas/components/canvas-object-menu";
import { GestureHarness, touchPointer } from "./touch-harness";

beforeAll(() => {
  // Radix's popper measures its anchor with ResizeObserver (absent in jsdom).
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Stand in for layout: what `document.elementFromPoint` reports. */
function withHit(hit: () => Element | null, run: () => void) {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hit });
  try {
    run();
  } finally {
    Reflect.deleteProperty(document, "elementFromPoint");
  }
}

describe("useCanvasTouchGestures: long-press", () => {
  it("dispatches a marked contextmenu on what's under the finger after the hold", () => {
    vi.useFakeTimers();
    render(<GestureHarness />);
    const item = screen.getByTestId("item");
    withHit(
      () => item,
      () => {
        const seen: boolean[] = [];
        item.addEventListener("contextmenu", (e) => seen.push(isCanvasLongPress(e)));
        item.dispatchEvent(touchPointer("pointerdown"));
        vi.advanceTimersByTime(499);
        expect(seen).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(seen).toEqual([true]);
      }
    );
  });

  it.each([
    ["finds nothing", () => null],
    ["lands outside the board", () => document.body],
  ])("falls back to the pressed element when hit-testing %s", (_label, hit) => {
    vi.useFakeTimers();
    render(<GestureHarness />);
    const item = screen.getByTestId("item");
    withHit(hit, () => {
      const seen: boolean[] = [];
      item.addEventListener("contextmenu", (e) => seen.push(isCanvasLongPress(e)));
      item.dispatchEvent(touchPointer("pointerdown"));
      vi.advanceTimersByTime(500);
      expect(seen).toEqual([true]);
    });
  });

  it("a finger that drifts isn't a long-press", () => {
    vi.useFakeTimers();
    render(<GestureHarness />);
    const item = screen.getByTestId("item");
    withHit(
      () => item,
      () => {
        const seen: Event[] = [];
        item.addEventListener("contextmenu", (e) => seen.push(e));
        item.dispatchEvent(touchPointer("pointerdown"));
        item.dispatchEvent(touchPointer("pointermove", { clientX: 70 }));
        vi.advanceTimersByTime(600);
        expect(seen).toEqual([]);
      }
    );
  });

  it("a mouse right-click isn't a long-press", () => {
    const e = new MouseEvent("contextmenu", { bubbles: true, button: 2 });
    expect(isCanvasLongPress(e)).toBe(false);
  });
});

function fakeActions() {
  return {
    deleteSelected: vi.fn(),
    duplicate: vi.fn(),
    copy: vi.fn(),
    bringToFront: vi.fn(),
    sendToBack: vi.fn(),
    toggleLock: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  } satisfies CanvasObjectActions;
}

function MenuHarness(props: {
  actions: CanvasObjectActions;
  canOpen?: () => boolean;
  allLocked?: boolean;
  onOpen?: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={viewportRef} data-testid="viewport">
      <div data-testid="item" />
      <CanvasObjectMenu
        viewportRef={viewportRef}
        actions={props.actions}
        canOpen={props.canOpen ?? (() => true)}
        allLocked={props.allLocked ?? false}
        onOpen={props.onOpen}
      />
    </div>
  );
}

const longPress = () => act(() => dispatchCanvasLongPress(screen.getByTestId("item"), 50, 60));

describe("CanvasObjectMenu", () => {
  it("opens at the touch point with the board's actions", () => {
    const onOpen = vi.fn();
    render(<MenuHarness actions={fakeActions()} onOpen={onOpen} />);
    longPress();
    const menu = screen.getByRole("menu", { name: "Object actions" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Above the board's selection handles and property bar (z 9997–9999).
    expect(menu.style.zIndex).toBe("10000");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Duplicate",
      "Copy",
      "Bring to front",
      "Send to back",
      "Lock",
      "Delete",
    ]);
    // Every row reaches 44 px on touch.
    for (const item of items) expect(item).toHaveClass("pointer-coarse:min-h-11");
  });

  it("runs the shared handler for each pick", () => {
    const actions = fakeActions();
    render(<MenuHarness actions={actions} />);
    const pick = (name: string) => {
      longPress();
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };
    pick("Delete");
    expect(actions.deleteSelected).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    pick("Duplicate");
    pick("Copy");
    pick("Bring to front");
    pick("Send to back");
    pick("Lock");
    expect(actions.duplicate).toHaveBeenCalledTimes(1);
    expect(actions.copy).toHaveBeenCalledTimes(1);
    expect(actions.bringToFront).toHaveBeenCalledTimes(1);
    expect(actions.sendToBack).toHaveBeenCalledTimes(1);
    expect(actions.toggleLock).toHaveBeenCalledTimes(1);
  });

  it("offers Unlock when everything selected is locked", () => {
    render(<MenuHarness actions={fakeActions()} allLocked />);
    longPress();
    expect(screen.getByRole("menuitem", { name: "Unlock" })).toBeInTheDocument();
  });

  it("stays shut when there's nothing to act on", () => {
    render(<MenuHarness actions={fakeActions()} canOpen={() => false} />);
    longPress();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("leaves a mouse right-click to the browser (desktop unchanged)", () => {
    render(<MenuHarness actions={fakeActions()} />);
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    act(() => {
      screen.getByTestId("item").dispatchEvent(e);
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(e.defaultPrevented).toBe(false);
  });
});
