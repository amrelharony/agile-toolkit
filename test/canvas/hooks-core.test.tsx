/**
 * Canvas hooks with no suite of their own: the undo stack, arrow-key nudge,
 * align / distribute, the mind-map Tab / Enter / Shift+Tab editor,
 * click-to-create, presentation mode, the "Catch me up" timestamp, remote
 * focus, and the canvas UI store's toggles. All driven through renderHook
 * with plain fixtures; nothing here needs WebGL or canvas pixels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardMindMapNode, WhiteboardObject } from "@/lib/stores/workspace-types";
import { MIND_MAP_NODE_DEFAULT } from "@/lib/whiteboard/mind-map-layout";
import { useCanvasUndoStack } from "@/app/(tools)/canvas/use-undo-stack";
import { useArrowKeyNudge } from "@/app/(tools)/canvas/hooks/use-arrow-key-nudge";
import { useAlignDistribute } from "@/app/(tools)/canvas/hooks/use-align-distribute";
import { useMindMapStructural } from "@/app/(tools)/canvas/hooks/use-mind-map-structural";
import { useAddObjectAt } from "@/app/(tools)/canvas/hooks/use-add-object-at";
import { usePresentationMode } from "@/app/(tools)/canvas/hooks/use-presentation-mode";
import { useBoardLastCatchup } from "@/app/(tools)/canvas/hooks/use-board-last-catchup";
import { useRemoteFocusReceiver } from "@/app/(tools)/canvas/hooks/use-remote-focus-receiver";
import { useCanvasStore, type CanvasTool } from "@/app/(tools)/canvas/use-canvas-store";
import { STICKY_DEFAULT, SHAPE_DEFAULT, TEXT_DEFAULT } from "@/app/(tools)/canvas/constants";
import {
  DIAGRAM_SHAPE_DEFAULT,
  DIAGRAM_SHAPE_KINDS,
  isDiagramShape,
} from "@/app/(tools)/canvas/components/objects/diagram-shape";
import {
  diagramShapeFixture,
  freehandFixture,
  lineFixture,
  mindMapNodeFixture,
  stickyFixture,
} from "./object-fixtures";

const byId = (objs: WhiteboardObject[]) => new Map(objs.map((o) => [o.id, o]));
const boardObjects = (boardId: string) =>
  (useWorkspaceStore.getState().whiteboardObjects ?? []).filter((o) => o.boardId === boardId);
const objectById = (id: string) =>
  (useWorkspaceStore.getState().whiteboardObjects ?? []).find((o) => o.id === id);

// ── useCanvasUndoStack ──────────────────────────────────────────────

describe("useCanvasUndoStack", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      whiteboardObjects: [
        stickyFixture({ id: "s1", boardId: "b1", x: 0, version: 1 }),
        stickyFixture({ id: "other", boardId: "b2", x: 7, version: 4 }),
      ],
    });
  });

  const move = (id: string, x: number) => {
    const o = objectById(id)!;
    useWorkspaceStore.getState().upsertWhiteboardObject({ ...o, x, version: o.version + 1 });
  };

  it("undoes to the snapshot and redoes back, bumping versions above the live ones", () => {
    const { result } = renderHook(() => useCanvasUndoStack("b1"));
    expect(result.current.canUndo()).toBe(false);
    act(() => result.current.pushSnapshot());
    move("s1", 50);

    act(() => result.current.undo());
    expect(objectById("s1")).toMatchObject({ x: 0, version: 3 });
    expect(result.current.canUndo()).toBe(false);
    expect(result.current.canRedo()).toBe(true);
    // Another board's objects are never touched.
    expect(objectById("other")).toMatchObject({ x: 7, version: 4 });

    act(() => result.current.redo());
    expect(objectById("s1")).toMatchObject({ x: 50, version: 4 });
    expect(result.current.canUndo()).toBe(true);
    expect(result.current.canRedo()).toBe(false);
  });

  it("brings back a deleted object and removes a created one", () => {
    const { result } = renderHook(() => useCanvasUndoStack("b1"));
    act(() => result.current.pushSnapshot());
    useWorkspaceStore.getState().removeWhiteboardObject("s1");
    act(() => result.current.pushSnapshot());
    useWorkspaceStore
      .getState()
      .upsertWhiteboardObject(stickyFixture({ id: "s2", boardId: "b1", version: 1 }));

    act(() => result.current.undo());
    expect(boardObjects("b1").map((o) => o.id)).toEqual([]);
    act(() => result.current.undo());
    expect(boardObjects("b1").map((o) => o.id)).toEqual(["s1"]);
  });

  it("skips a snapshot identical to the last one", () => {
    const { result } = renderHook(() => useCanvasUndoStack("b1"));
    act(() => {
      result.current.pushSnapshot();
      result.current.pushSnapshot();
      result.current.pushSnapshot();
    });
    move("s1", 10);
    act(() => result.current.undo());
    expect(result.current.canUndo()).toBe(false);
  });

  it("drops the redo stack on a new edit", () => {
    const { result } = renderHook(() => useCanvasUndoStack("b1"));
    act(() => result.current.pushSnapshot());
    move("s1", 10);
    act(() => result.current.undo());
    expect(result.current.canRedo()).toBe(true);
    act(() => result.current.pushSnapshot());
    expect(result.current.canRedo()).toBe(false);
  });

  it("keeps at most 50 steps", () => {
    const { result } = renderHook(() => useCanvasUndoStack("b1"));
    for (let i = 1; i <= 55; i++) {
      act(() => result.current.pushSnapshot());
      move("s1", i);
    }
    let undos = 0;
    while (result.current.canUndo()) {
      act(() => result.current.undo());
      undos++;
    }
    expect(undos).toBe(50);
    // The oldest five steps fell off: the earliest reachable state is x=5.
    expect(objectById("s1")!.x).toBe(5);
  });

  it("forgets history on a board switch and does nothing without a board", () => {
    const { result, rerender } = renderHook(({ id }) => useCanvasUndoStack(id), {
      initialProps: { id: "b1" as string | null },
    });
    act(() => result.current.pushSnapshot());
    rerender({ id: "b2" });
    expect(result.current.canUndo()).toBe(false);

    rerender({ id: null });
    act(() => {
      result.current.pushSnapshot();
      result.current.undo();
      result.current.redo();
    });
    expect(result.current.canUndo()).toBe(false);
  });

  it("snapshots a deep copy, so a later in-place change can't rewrite history", () => {
    useWorkspaceStore.setState({
      whiteboardObjects: [freehandFixture({ id: "f1", boardId: "b1", points: [0, 0, 5, 5] })],
    });
    const { result } = renderHook(() => useCanvasUndoStack("b1"));
    act(() => result.current.pushSnapshot());
    const live = objectById("f1") as Extract<WhiteboardObject, { type: "freehand" }>;
    live.points[0] = 999; // a careless mutation of store state
    useWorkspaceStore.getState().upsertWhiteboardObject({ ...live, version: live.version + 1 });
    act(() => result.current.undo());
    expect((objectById("f1") as typeof live).points).toEqual([0, 0, 5, 5]);
  });
});

// ── useArrowKeyNudge ────────────────────────────────────────────────

describe("useArrowKeyNudge", () => {
  let frames: FrameRequestCallback[] = [];
  let board: HTMLDivElement;

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    board = document.createElement("div");
    document.body.appendChild(board);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    board.remove();
  });

  const flushFrames = () => {
    const pending = frames;
    frames = [];
    act(() => pending.forEach((cb) => cb(0)));
  };

  function setup(
    objs: WhiteboardObject[],
    over: { readOnly?: boolean; presenting?: boolean } = {}
  ) {
    const upsertMany = vi.fn();
    const pushSnapshot = vi.fn();
    const { unmount } = renderHook(() =>
      useArrowKeyNudge({
        selection: objs.map((o) => o.id),
        objectsById: byId(objs),
        upsertMany,
        pushSnapshot,
        readOnly: over.readOnly ?? false,
        presentationFrameIndex: over.presenting ? 0 : null,
        viewportRef: { current: board },
      })
    );
    return { upsertMany, pushSnapshot, unmount };
  }

  it("moves the selection 1px per arrow, 10px with Shift, batched into one update per frame", () => {
    const s = stickyFixture({ id: "s1", x: 100, y: 80, version: 2 });
    const { upsertMany, pushSnapshot } = setup([s]);
    fireEvent.keyDown(board, { key: "ArrowRight" });
    fireEvent.keyDown(board, { key: "ArrowRight" });
    fireEvent.keyDown(board, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(board, { key: "ArrowLeft" });
    expect(upsertMany).not.toHaveBeenCalled();
    flushFrames();
    expect(upsertMany).toHaveBeenCalledTimes(1);
    expect(upsertMany.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: "s1", x: 101, y: 90, version: 3 }),
    ]);
    // One undo entry for the whole burst.
    expect(pushSnapshot).toHaveBeenCalledTimes(1);
  });

  it("starts a new undo entry after the arrow key is released", () => {
    const { pushSnapshot } = setup([stickyFixture({ id: "s1" })]);
    fireEvent.keyDown(board, { key: "ArrowUp" });
    fireEvent.keyUp(board, { key: "ArrowUp" });
    fireEvent.keyDown(board, { key: "ArrowUp" });
    expect(pushSnapshot).toHaveBeenCalledTimes(2);
  });

  it("moves freehand ink with its box", () => {
    const f = freehandFixture({ id: "f1", x: 0, y: 0, points: [0, 0, 10, 10] });
    const { upsertMany } = setup([f]);
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    flushFrames();
    expect(upsertMany.mock.calls[0][0][0]).toMatchObject({ x: 10, points: [10, 0, 20, 10] });
  });

  it("stays still when read-only, presenting, focus is elsewhere, or for other keys", () => {
    const s = stickyFixture({ id: "s1" });
    const ro = setup([s], { readOnly: true });
    fireEvent.keyDown(board, { key: "ArrowRight" });
    flushFrames();
    ro.unmount();
    const pres = setup([s], { presenting: true });
    fireEvent.keyDown(board, { key: "ArrowRight" });
    flushFrames();
    pres.unmount();
    const outside = setup([s]);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(board, { key: "a" });
    flushFrames();
    for (const h of [ro, pres, outside]) {
      expect(h.upsertMany).not.toHaveBeenCalled();
      expect(h.pushSnapshot).not.toHaveBeenCalled();
    }
  });

  it("leaves the arrows to a select or slider inside the board", () => {
    const { upsertMany } = setup([stickyFixture({ id: "s1" })]);
    const slider = document.createElement("input");
    slider.type = "range";
    board.appendChild(slider);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    flushFrames();
    expect(upsertMany).not.toHaveBeenCalled();
  });

  // Bug: arrow keys moved locked objects, which drag, align and the
  // property panel all refuse to move (PDF pages are imported locked).
  it("doesn't move locked objects, and records no undo step when nothing can move", () => {
    const locked = stickyFixture({ id: "locked", x: 100, locked: true });
    const free = stickyFixture({ id: "free", x: 100 });
    const both = setup([locked, free]);
    fireEvent.keyDown(board, { key: "ArrowRight" });
    flushFrames();
    expect(both.upsertMany).toHaveBeenCalledTimes(1);
    expect(both.upsertMany.mock.calls[0][0].map((o: WhiteboardObject) => o.id)).toEqual(["free"]);
    both.unmount();

    const onlyLocked = setup([locked]);
    fireEvent.keyDown(board, { key: "ArrowRight" });
    flushFrames();
    expect(onlyLocked.upsertMany).not.toHaveBeenCalled();
    expect(onlyLocked.pushSnapshot).not.toHaveBeenCalled();
  });
});

// ── useAlignDistribute ──────────────────────────────────────────────

describe("useAlignDistribute", () => {
  function setup(objs: WhiteboardObject[]) {
    const upsertMany = vi.fn();
    const pushSnapshot = vi.fn();
    const log = vi.fn();
    const { result } = renderHook(() =>
      useAlignDistribute({
        selection: objs.map((o) => o.id),
        objectsById: byId(objs),
        upsertMany,
        pushSnapshot,
        log,
      })
    );
    return { ...result.current, upsertMany, pushSnapshot, log };
  }

  it("aligns left edges to the selection's left edge", () => {
    const h = setup([
      stickyFixture({ id: "a", x: 40, y: 0, w: 100, version: 1 }),
      stickyFixture({ id: "b", x: 200, y: 300, w: 50, version: 5 }),
    ]);
    act(() => h.onAlign("align-left"));
    expect(h.pushSnapshot).toHaveBeenCalledTimes(1);
    expect(h.upsertMany).toHaveBeenCalledTimes(1);
    expect(h.upsertMany.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: "b", x: 40, y: 300, version: 6 }),
    ]);
    expect(h.log).toHaveBeenCalledWith("objects_moved", { count: 1, action: "align-left" });
  });

  it("aligns a right-to-left arrow by its drawn extent and moves ink with its box", () => {
    const h = setup([
      // Drawn leftwards: spans x 100..300 although x is 300.
      lineFixture("arrow", { id: "arr", x: 300, y: 0, w: -200, h: 10 }),
      freehandFixture({ id: "ink", x: 150, y: 50, w: 20, h: 20, points: [150, 50, 170, 70] }),
    ]);
    act(() => h.onAlign("align-left"));
    const moved = h.upsertMany.mock.calls[0][0] as WhiteboardObject[];
    expect(moved.map((o) => o.id)).toEqual(["ink"]);
    expect(moved[0]).toMatchObject({ x: 100, points: [100, 50, 120, 70] });
  });

  it("needs two unlocked objects to align and three to distribute", () => {
    const h = setup([
      stickyFixture({ id: "a", x: 0 }),
      stickyFixture({ id: "b", x: 500, locked: true }),
    ]);
    act(() => h.onAlign("align-left"));
    const d = setup([stickyFixture({ id: "a", x: 0 }), stickyFixture({ id: "b", x: 500 })]);
    act(() => d.onDistribute("distribute-h"));
    for (const x of [h, d]) {
      expect(x.upsertMany).not.toHaveBeenCalled();
      expect(x.pushSnapshot).not.toHaveBeenCalled();
    }
  });

  it("spaces three objects evenly between the outer two", () => {
    const h = setup([
      stickyFixture({ id: "a", x: 0, w: 100 }),
      stickyFixture({ id: "b", x: 120, w: 100 }),
      stickyFixture({ id: "c", x: 500, w: 100 }),
    ]);
    act(() => h.onDistribute("distribute-h"));
    const moved = h.upsertMany.mock.calls[0][0] as WhiteboardObject[];
    expect(moved.map((o) => [o.id, o.x])).toEqual([["b", 250]]);
  });

  // Bug: an align or distribute that moved nothing still bumped every
  // object's version, logged a move and pushed an undo step the user then
  // had to Cmd+Z past.
  it("records nothing when no object actually moves", () => {
    const aligned = setup([
      stickyFixture({ id: "a", x: 40, y: 0 }),
      stickyFixture({ id: "b", x: 40, y: 300 }),
    ]);
    act(() => aligned.onAlign("align-left"));
    // Overlapping objects can't be distributed: positions come back as they were.
    const crowded = setup([
      stickyFixture({ id: "a", x: 0, w: 200 }),
      stickyFixture({ id: "b", x: 50, w: 200 }),
      stickyFixture({ id: "c", x: 100, w: 200 }),
    ]);
    act(() => crowded.onDistribute("distribute-h"));
    for (const h of [aligned, crowded]) {
      expect(h.upsertMany).not.toHaveBeenCalled();
      expect(h.pushSnapshot).not.toHaveBeenCalled();
      expect(h.log).not.toHaveBeenCalled();
    }
  });
});

// ── useMindMapStructural ────────────────────────────────────────────

describe("useMindMapStructural", () => {
  const T = "2026-01-01T00:00:00.000Z";
  const node = (id: string, parentNodeId: string | undefined, createdAt = T) =>
    mindMapNodeFixture({
      id,
      boardId: "b1",
      parentNodeId,
      mindMapId: "mm",
      x: 0,
      y: 0,
      w: MIND_MAP_NODE_DEFAULT.w,
      h: MIND_MAP_NODE_DEFAULT.h,
      text: id,
      version: 1,
      createdAt,
    });

  function setup(objs: WhiteboardObject[], readOnly = false) {
    const upsertMany = vi.fn();
    const pushSnapshot = vi.fn();
    const setSelection = vi.fn();
    const setEditingObjectId = vi.fn();
    const { result } = renderHook(() =>
      useMindMapStructural({
        boardId: "b1",
        objects: objs,
        objectsById: byId(objs),
        upsertMany,
        setSelection,
        setEditingObjectId,
        pushSnapshot,
        topZRef: { current: 7 },
        readOnly,
      })
    );
    const patched = () =>
      new Map(
        (upsertMany.mock.calls[0]?.[0] ?? []).map((o: WhiteboardMindMapNode) => [o.id, o])
      ) as Map<string, WhiteboardMindMapNode>;
    return {
      act: result.current,
      upsertMany,
      pushSnapshot,
      setSelection,
      setEditingObjectId,
      patched,
    };
  }

  it("Tab adds an empty child, lays it out to the right, and starts editing it", () => {
    const root = { ...node("root", undefined), x: 100, y: 200 };
    const h = setup([root]);
    act(() => h.act("root", "child", "Big idea"));
    expect(h.pushSnapshot).toHaveBeenCalledTimes(1);
    const out = h.patched();
    expect(out.size).toBe(2);
    const child = Array.from(out.values()).find((n) => n.id !== "root")!;
    expect(child).toMatchObject({
      parentNodeId: "root",
      mindMapId: "mm",
      text: "",
      z: 8,
      version: 1,
      x: 100 + MIND_MAP_NODE_DEFAULT.w + 64,
    });
    // The root keeps its place and gets the committed text.
    expect(out.get("root")).toMatchObject({ text: "Big idea", x: 100, y: 200, version: 2 });
    expect(h.setSelection).toHaveBeenCalledWith([child.id]);
    expect(h.setEditingObjectId).toHaveBeenCalledWith(child.id);
  });

  it("Enter adds a sibling under the same parent", () => {
    const h = setup([node("root", undefined), node("a", "root")]);
    act(() => h.act("a", "sibling", "A"));
    const added = Array.from(h.patched().values()).filter((n) => n.id !== "root" && n.id !== "a");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ parentNodeId: "root", text: "" });
    expect(h.setEditingObjectId).toHaveBeenLastCalledWith(added[0].id);
  });

  it("Enter on the root only commits its text", () => {
    const h = setup([node("root", undefined)]);
    act(() => h.act("root", "sibling", "Renamed"));
    expect(h.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ id: "root", text: "Renamed", version: 2 }),
    ]);
    expect(h.setSelection).not.toHaveBeenCalled();
    expect(h.setEditingObjectId).toHaveBeenCalledWith(null);
  });

  it("Shift+Tab moves a grandchild up to its grandparent", () => {
    const h = setup([node("root", undefined), node("a", "root"), node("g", "a")]);
    act(() => h.act("g", "promote", "G"));
    expect(h.patched().get("g")).toMatchObject({ parentNodeId: "root", text: "G" });
    expect(h.setSelection).toHaveBeenCalledWith(["g"]);
    expect(h.setEditingObjectId).toHaveBeenCalledWith(null);
  });

  it("Shift+Tab on a first-level node only commits its text", () => {
    const h = setup([node("root", undefined), node("a", "root")]);
    act(() => h.act("a", "promote", "A2"));
    expect(h.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ id: "a", parentNodeId: "root", text: "A2" }),
    ]);
  });

  it("does nothing but close the editor when read-only or the node isn't a mind-map node", () => {
    const ro = setup([node("root", undefined)], true);
    act(() => ro.act("root", "child", "x"));
    const wrong = setup([stickyFixture({ id: "s1" })]);
    act(() => wrong.act("s1", "child", "x"));
    const missing = setup([]);
    act(() => missing.act("nope", "child", "x"));
    for (const h of [ro, wrong, missing]) {
      expect(h.upsertMany).not.toHaveBeenCalled();
      expect(h.pushSnapshot).not.toHaveBeenCalled();
      expect(h.setEditingObjectId).toHaveBeenCalledWith(null);
    }
  });

  it("lays out only the edited node's own map", () => {
    const other = { ...node("other", undefined), mindMapId: "mm2", x: 999, y: 999 };
    const h = setup([node("root", undefined), other]);
    act(() => h.act("root", "child", "R"));
    expect(h.patched().has("other")).toBe(false);
  });
});

// ── useAddObjectAt ──────────────────────────────────────────────────

describe("useAddObjectAt", () => {
  function setup(tool: CanvasTool, pickedDiagramShape = "server") {
    const calls: string[] = [];
    const upsert = vi.fn<(obj: WhiteboardObject) => void>(() => {
      calls.push("upsert");
    });
    const pushSnapshot = vi.fn(() => {
      calls.push("snapshot");
    });
    const setTool = vi.fn();
    const setSelection = vi.fn();
    const setEditingObjectId = vi.fn();
    const logActivity = vi.fn();
    const { result } = renderHook(() =>
      useAddObjectAt({
        boardId: "b1",
        stickyColor: "#abcdef",
        tool,
        topZRef: { current: 41 },
        pickedDiagramShape,
        upsert,
        setTool,
        setSelection,
        setEditingObjectId,
        pushSnapshot,
        logActivity,
      })
    );
    const add = (x: number, y: number) => act(() => result.current(x, y));
    const created = () => upsert.mock.calls[0]?.[0] as WhiteboardObject | undefined;
    return { add, created, calls, setTool, setSelection, setEditingObjectId, logActivity };
  }

  it("centres a sticky on the click, on top, and opens it for typing", () => {
    const h = setup("sticky");
    h.add(500, 300);
    expect(h.created()).toMatchObject({
      type: "sticky",
      boardId: "b1",
      x: 500 - STICKY_DEFAULT.w / 2,
      y: 300 - STICKY_DEFAULT.h / 2,
      w: STICKY_DEFAULT.w,
      h: STICKY_DEFAULT.h,
      z: 42,
      version: 1,
      content: "",
      color: "#abcdef",
    });
    // Snapshot of the board BEFORE the new object, so undo removes just it.
    expect(h.calls).toEqual(["snapshot", "upsert"]);
    expect(h.setTool).toHaveBeenCalledWith("select");
    expect(h.setSelection).toHaveBeenCalledWith([h.created()!.id]);
    expect(h.setEditingObjectId).toHaveBeenCalledWith(h.created()!.id);
    expect(h.logActivity).toHaveBeenCalledWith("added", "Created sticky");
  });

  it("creates each shape kind at the default size", () => {
    for (const tool of ["rect", "ellipse", "diamond", "triangle"] as const) {
      const h = setup(tool);
      h.add(0, 0);
      expect(h.created()).toMatchObject({
        type: tool,
        x: -SHAPE_DEFAULT.w / 2,
        y: -SHAPE_DEFAULT.h / 2,
        w: SHAPE_DEFAULT.w,
        h: SHAPE_DEFAULT.h,
      });
      // Shapes aren't text-first: no edit mode.
      expect(h.setEditingObjectId).not.toHaveBeenCalled();
    }
  });

  it("puts a text box's top edge at the click and edits it", () => {
    const h = setup("text");
    h.add(100, 100);
    expect(h.created()).toMatchObject({
      type: "text",
      x: 100 - TEXT_DEFAULT.w / 2,
      y: 100,
      content: "Text",
    });
    expect(h.setEditingObjectId).toHaveBeenCalled();
  });

  it("builds the composite widgets with their starter content", () => {
    const kanban = setup("kanban");
    kanban.add(0, 0);
    expect(kanban.created()).toMatchObject({
      type: "kanban",
      columns: ["todo", "in_progress", "done"],
      columnLabels: ["To Do", "In Progress", "Done"],
    });
    const timer = setup("timer");
    timer.add(0, 0);
    expect(timer.created()).toMatchObject({ durationSec: 300, remainingSec: 300, running: false });
    const voting = setup("voting");
    voting.add(0, 0);
    expect(voting.created()).toMatchObject({ votes: {}, revealed: false });
    const table = setup("table");
    table.add(0, 0);
    expect(table.created()).toMatchObject({ headerRow: true });
    expect((table.created() as Extract<WhiteboardObject, { type: "table" }>).rows).toHaveLength(3);
    for (const h of [kanban, timer, voting, table])
      expect(h.setEditingObjectId).not.toHaveBeenCalled();
  });

  it("uses the picked diagram shape, or a database for an unknown pick", () => {
    const picked = setup("diagramShape", "cloud");
    picked.add(60, 44);
    expect(picked.created()).toMatchObject({
      type: "diagramShape",
      kind: "cloud",
      x: 60 - DIAGRAM_SHAPE_DEFAULT.w / 2,
      y: 44 - DIAGRAM_SHAPE_DEFAULT.h / 2,
      label: "",
    });
    const unknown = setup("diagramShape", "teleporter");
    unknown.add(0, 0);
    expect(unknown.created()).toMatchObject({ kind: "database" });
  });

  it("starts a new mind map whose id is the root's own", () => {
    const h = setup("mindMap");
    h.add(0, 0);
    const root = h.created() as WhiteboardMindMapNode;
    expect(root).toMatchObject({ type: "mindMapNode", text: "" });
    expect(root.parentNodeId).toBeUndefined();
    expect(root.mindMapId).toBe(root.id);
    expect(h.setEditingObjectId).toHaveBeenCalledWith(root.id);
  });

  it("does nothing for tools that don't click-create", () => {
    for (const tool of [
      "select",
      "hand",
      "line",
      "arrow",
      "freehand",
      "connector",
      "comment",
    ] as CanvasTool[]) {
      const h = setup(tool);
      h.add(0, 0);
      expect(h.created()).toBeUndefined();
      expect(h.calls).toEqual([]);
      expect(h.setTool).not.toHaveBeenCalled();
    }
  });
});

// ── usePresentationMode ─────────────────────────────────────────────

describe("usePresentationMode", () => {
  const frames = [
    { x: 0, y: 0, w: 400, h: 300 },
    { x: 1000, y: 0, w: 400, h: 300 },
    { x: 2000, y: 0, w: 400, h: 300 },
  ];

  function setup(index: number | null, size = { w: 1000, h: 800 }) {
    const setCamera = vi.fn();
    const setIndex = vi.fn();
    renderHook(() =>
      usePresentationMode({
        presentationFrameIndex: index,
        orderedFrames: frames,
        size,
        setCamera,
        setPresentationFrameIndex: setIndex,
      })
    );
    return { setCamera, setIndex };
  }

  it("fits the camera to the current frame", () => {
    const h = setup(1);
    expect(h.setCamera).toHaveBeenCalledTimes(1);
    const cam = h.setCamera.mock.calls[0][0];
    // The frame's centre lands in the middle of the viewport.
    const centreX = (1200 - cam.x) * cam.zoom;
    expect(Number.isFinite(cam.zoom) && cam.zoom > 0).toBe(true);
    expect(Math.abs(centreX - 500)).toBeLessThan(1);
  });

  it("waits for the viewport size, and ignores a frame index out of range", () => {
    expect(setup(0, { w: 0, h: 0 }).setCamera).not.toHaveBeenCalled();
    expect(setup(9).setCamera).not.toHaveBeenCalled();
  });

  it("steps with the arrows and Space, clamped to the deck, and exits on Escape", () => {
    const mid = setup(1);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mid.setIndex.mock.calls).toEqual([[2], [2], [0], [null]]);
  });

  it("doesn't step past either end", () => {
    const last = setup(2);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(last.setIndex).toHaveBeenLastCalledWith(2);
  });

  it("leaves typing fields and a focused button alone, and listens only while presenting", () => {
    const h = setup(0);
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(button, { key: " " });
    expect(h.setIndex).not.toHaveBeenCalled();
    input.remove();
    button.remove();

    const off = setup(null);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(off.setIndex).not.toHaveBeenCalled();
    expect(off.setCamera).not.toHaveBeenCalled();
  });
});

// ── useBoardLastCatchup ─────────────────────────────────────────────

describe("useBoardLastCatchup", () => {
  const KEY = "agile-toolkit:canvas:last-catchup";
  const NOW = Date.parse("2026-10-18T12:00:00.000Z");
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("starts a week back on a board never caught up", () => {
    const { result } = renderHook(() => useBoardLastCatchup("b1"));
    expect(result.current.lastCatchupAt).toBe(NOW - WEEK);
  });

  it("reads the stored time per board, ignoring junk values", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ b1: 1000, b2: "soon", b3: -5 }));
    expect(renderHook(() => useBoardLastCatchup("b1")).result.current.lastCatchupAt).toBe(1000);
    expect(renderHook(() => useBoardLastCatchup("b2")).result.current.lastCatchupAt).toBe(
      NOW - WEEK
    );
    expect(renderHook(() => useBoardLastCatchup("b3")).result.current.lastCatchupAt).toBe(
      NOW - WEEK
    );
    window.localStorage.setItem(KEY, "{broken");
    expect(renderHook(() => useBoardLastCatchup("b1")).result.current.lastCatchupAt).toBe(
      NOW - WEEK
    );
  });

  it("marks a board caught up now, keeping the other boards' times", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ b2: 1000 }));
    const { result } = renderHook(() => useBoardLastCatchup("b1"));
    act(() => result.current.markCaughtUp());
    expect(result.current.lastCatchupAt).toBe(NOW);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ b1: NOW, b2: 1000 });
  });

  it("re-reads when the board changes", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ b1: 1000, b2: 2000 }));
    const { result, rerender } = renderHook(({ id }) => useBoardLastCatchup(id), {
      initialProps: { id: "b1" },
    });
    rerender({ id: "b2" });
    expect(result.current.lastCatchupAt).toBe(2000);
  });
});

// ── useRemoteFocusReceiver ──────────────────────────────────────────

describe("useRemoteFocusReceiver", () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 };

  it("snaps the camera once per focus event, not again on a resize", () => {
    const setCamera = vi.fn();
    const focus = { kind: "snap" as const, rect };
    const { result, rerender } = renderHook(
      ({ size }) => useRemoteFocusReceiver({ remoteFocus: focus, size, setCamera }),
      { initialProps: { size: { w: 1000, h: 800 } } }
    );
    expect(setCamera).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
    rerender({ size: { w: 1200, h: 900 } });
    expect(setCamera).toHaveBeenCalledTimes(1);
  });

  it("waits for a measured viewport before snapping", () => {
    const setCamera = vi.fn();
    const focus = { kind: "snap" as const, rect };
    const { rerender } = renderHook(
      ({ size }) => useRemoteFocusReceiver({ remoteFocus: focus, size, setCamera }),
      { initialProps: { size: { w: 0, h: 0 } } }
    );
    expect(setCamera).not.toHaveBeenCalled();
    rerender({ size: { w: 1000, h: 800 } });
    expect(setCamera).toHaveBeenCalledTimes(1);
  });

  it("returns a spotlight's rect without moving the camera, and clears it", () => {
    const setCamera = vi.fn();
    const { result, rerender } = renderHook(
      ({ focus }) =>
        useRemoteFocusReceiver({ remoteFocus: focus, size: { w: 1000, h: 800 }, setCamera }),
      {
        initialProps: {
          focus: { kind: "spotlight", rect } as Parameters<
            typeof useRemoteFocusReceiver
          >[0]["remoteFocus"],
        },
      }
    );
    expect(result.current).toEqual(rect);
    expect(setCamera).not.toHaveBeenCalled();
    rerender({ focus: null });
    expect(result.current).toBeNull();
  });
});

// ── useCanvasStore toggles ──────────────────────────────────────────

describe("useCanvasStore", () => {
  beforeEach(() => {
    useCanvasStore.setState({
      selection: [],
      frameBookmarks: {},
      tagFilter: [],
      activeBoardId: null,
    });
  });

  it("toggles selection: a plain click picks one, or clears a lone pick; Shift adds and removes", () => {
    const s = () => useCanvasStore.getState();
    s().toggleSelection("a");
    expect(s().selection).toEqual(["a"]);
    s().toggleSelection("a");
    expect(s().selection).toEqual([]);
    s().toggleSelection("a");
    s().toggleSelection("b", true);
    s().toggleSelection("c", true);
    expect(s().selection).toEqual(["a", "b", "c"]);
    s().toggleSelection("b", true);
    expect(s().selection).toEqual(["a", "c"]);
    // A plain click on one of several picks just that one.
    s().toggleSelection("a");
    expect(s().selection).toEqual(["a"]);
  });

  it("toggles frame bookmarks per board", () => {
    const s = () => useCanvasStore.getState();
    s().toggleFrameBookmark("b1", "f1");
    s().toggleFrameBookmark("b1", "f2");
    s().toggleFrameBookmark("b2", "f1");
    s().toggleFrameBookmark("b1", "f1");
    expect(s().frameBookmarks).toEqual({ b1: ["f2"], b2: ["f1"] });
  });

  it("toggles tag filters", () => {
    const s = () => useCanvasStore.getState();
    s().toggleTagFilter("risk");
    s().toggleTagFilter("ux");
    s().toggleTagFilter("risk");
    expect(s().tagFilter).toEqual(["ux"]);
  });

  it("clears the selection on a board switch and never stores it", () => {
    const s = () => useCanvasStore.getState();
    s().setSelection(["a", "b"]);
    s().setActiveBoard("b9");
    expect(s().selection).toEqual([]);
    s().setSelection(["c"]);
    const saved = JSON.parse(window.localStorage.getItem("agile-toolkit:canvas") ?? "{}");
    expect(saved.state.activeBoardId).toBe("b9");
    expect(saved.state).not.toHaveProperty("selection");
    expect(saved.state).not.toHaveProperty("tagFilter");
  });
});

// ── Diagram shapes ──────────────────────────────────────────────────

describe("diagram shape registry", () => {
  it("has a label, icon and tint for every kind, and narrows by type", () => {
    for (const [kind, def] of Object.entries(DIAGRAM_SHAPE_KINDS)) {
      expect(def.label.length, kind).toBeGreaterThan(0);
      expect(def.icon, kind).toBeTruthy();
      expect(def.tint, kind).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(isDiagramShape(diagramShapeFixture())).toBe(true);
    expect(isDiagramShape(stickyFixture())).toBe(false);
  });
});
