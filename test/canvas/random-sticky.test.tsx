import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { frameFixture, shapeFixture, stickyFixture } from "./object-fixtures";
import { pickPoolFor, pickRandomSticky, randomStickyPool } from "@/lib/whiteboard/random-sticky";
import { PropertyPanel } from "@/app/(tools)/canvas/components/property-panel";
import { createRng } from "@/lib/utils/random";

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { info: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

import { WhiteboardCanvas } from "@/app/(tools)/canvas/components/whiteboard-canvas";
import { useCanvasStore } from "@/app/(tools)/canvas/use-canvas-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Canvas's "Pick a random sticky" (Picker's add-on, kept small: Canvas is a
 * scoped upgrade). The pool is the selected stickies, or the stickies in a
 * selected frame; the board selects the one picked, so it's highlighted and
 * read out like any selection.
 */

const a = stickyFixture({ id: "a", x: 0, y: 0, w: 100, h: 100 });
const b = stickyFixture({ id: "b", x: 200, y: 0, w: 100, h: 100 });
const c = stickyFixture({ id: "c", x: 900, y: 900, w: 100, h: 100 });
const owned = stickyFixture({ id: "owned", x: 5000, y: 5000, frameId: "f" });
const frame = frameFixture({ id: "f", x: -10, y: -10, w: 400, h: 200 });
const box = shapeFixture("rect", { id: "box" });
const all = [a, b, c, owned, frame, box];

describe("randomStickyPool", () => {
  it("picks between two or more selected stickies, ignoring other objects", () => {
    expect(randomStickyPool([a, b, box], all).map((s) => s.id)).toEqual(["a", "b"]);
    expect(randomStickyPool([a, box], all)).toEqual([]);
  });

  it("uses the stickies inside a selected frame: by position or by frame id", () => {
    expect(randomStickyPool([frame], all).map((s) => s.id)).toEqual(["a", "b", "owned"]);
    expect(randomStickyPool([frameFixture({ id: "empty", x: 3000, y: 3000 })], all)).toEqual([]);
  });

  it("picks one of the pool, each equally likely", () => {
    const rng = createRng(5);
    const counts = new Map<string, number>();
    for (let i = 0; i < 900; i++) {
      const id = pickRandomSticky([a, b, c], rng)!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const id of ["a", "b", "c"]) expect(counts.get(id)!).toBeGreaterThan(240);
    expect(pickRandomSticky([])).toBeNull();
  });

  it("picks again from the same pool while the last pick is the selection, moving on", () => {
    const last = { pool: ["a", "b"], picked: "a" };
    expect(pickPoolFor([a], all, last).map((s) => s.id)).toEqual(["a", "b"]);
    // Anything else selected: the old pool is gone.
    expect(pickPoolFor([b], all, last)).toEqual([]);
    expect(pickPoolFor([a], all, null)).toEqual([]);
    const rng = createRng(3);
    for (let i = 0; i < 20; i++) expect(pickRandomSticky([a, b], rng, "a")).toBe("b");
    expect(pickRandomSticky([a], rng, "a")).toBe("a");
  });
});

describe("the property bar's button", () => {
  const props = {
    selection: [a, b],
    selectionBbox: { x: 0, y: 200, w: 300, h: 100 },
    camera: { x: 0, y: 0, zoom: 1 },
    viewportHeight: 600,
    onPatch: vi.fn(),
  };

  it("shows only when there's something to pick between, and asks the board to pick", () => {
    const onPick = vi.fn();
    const { rerender } = render(<PropertyPanel {...props} onPickRandomSticky={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick a random sticky" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Pick a random sticky" })).toHaveClass(
      "pointer-coarse:h-11",
      "pointer-coarse:w-11"
    );
    rerender(<PropertyPanel {...props} />);
    expect(screen.queryByRole("button", { name: "Pick a random sticky" })).toBeNull();
  });
});

describe("on the board", () => {
  class NoResize {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", NoResize);
    useWorkspaceStore.setState({ whiteboardObjects: [frame, a, b, c, box] });
    useCanvasStore.setState({ selection: [], tool: "select" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useCanvasStore.setState({ selection: [] });
  });

  it("selects one sticky from the selected frame, and keeps the button (and focus) to pick again", async () => {
    render(<WhiteboardCanvas boardId="board-1" />);
    act(() => useCanvasStore.getState().setSelection(["f"]));
    const button = await screen.findByRole("button", { name: "Pick a random sticky" });
    button.focus();
    fireEvent.click(button);
    const [picked] = useCanvasStore.getState().selection;
    expect(useCanvasStore.getState().selection).toHaveLength(1);
    // a and b sit inside the frame; c is outside it.
    expect(["a", "b"]).toContain(picked);
    const again = screen.getByRole("button", { name: "Pick a random sticky" });
    expect(again).toHaveFocus();
    fireEvent.click(again);
    const [next] = useCanvasStore.getState().selection;
    expect(["a", "b"]).toContain(next);
    expect(next).not.toBe(picked);
  });

  it("offers nothing for a single sticky the board didn't pick", async () => {
    render(<WhiteboardCanvas boardId="board-1" />);
    act(() => useCanvasStore.getState().setSelection(["c"]));
    await screen.findByRole("toolbar", { name: "Object properties" });
    expect(screen.queryByRole("button", { name: "Pick a random sticky" })).toBeNull();
  });
});
