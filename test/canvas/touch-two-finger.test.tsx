import { useRef } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Camera } from "@/lib/geometry/bbox";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { useCanvasPointerMachine } from "@/app/(tools)/canvas/hooks/use-canvas-pointer-machine";
import { useCanvasStore, type CanvasTool } from "@/app/(tools)/canvas/use-canvas-store";
import { stickyFixture } from "./object-fixtures";

/**
 * Two-finger pan (mobile audit #22). The pinch pans and zooms the board,
 * but each finger also reached the pointer machine as a one-finger
 * gesture: a two-finger pan with the select tool cleared the selection
 * and marquee-selected what lay between the fingers, and with the hand
 * tool it panned by the jumps between fingers over the pinch's camera.
 * Now a second finger cancels the first one's gesture and the machine
 * leaves touches to the pinch until a fresh first finger lands.
 */

// jsdom has no pointer capture.
const captureMethods = ["setPointerCapture", "releasePointerCapture", "hasPointerCapture"] as const;
beforeAll(() => {
  for (const name of captureMethods) {
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      value: name === "hasPointerCapture" ? () => false : () => {},
    });
  }
});
afterAll(() => {
  for (const name of captureMethods) Reflect.deleteProperty(Element.prototype, name);
});

// A sticky between the two fingers: a stray marquee would select it.
const between = stickyFixture({ id: "between", x: 90, y: 40, w: 20, h: 20 });
const objects: WhiteboardObject[] = [between];
const objectsById = new Map(objects.map((o) => [o.id, o]));

function MachineHarness(props: {
  tool: CanvasTool;
  throttledSetCamera?: (c: Camera) => void;
  multiTouch?: (ref: { readonly current: boolean | null }) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportRectRef = useRef<DOMRect | null>({ left: 0, top: 0 } as DOMRect);
  // Stable like the board's own refs: the machine's effects depend on them.
  const spaceHeldRef = useRef(false);
  const topZRef = useRef(10);
  const dragGuidesRef = useRef([]);
  const anyPenActiveRef = useRef(new Set<number>());
  const wetInkApiRef = useRef(null);
  const s = useCanvasStore();
  const noop = () => {};
  const machine = useCanvasPointerMachine({
    boardId: "board-1",
    readOnly: false,
    canComment: false,
    camera: s.camera,
    tool: props.tool,
    stickyColor: "#fde68a",
    snapToGridEnabled: false,
    snapToObjectsEnabled: false,
    pendingConnectorFromId: null,
    drag: s.drag,
    resize: s.resize,
    rotation: s.rotation,
    marquee: s.marquee,
    drawing: s.drawing,
    setMarquee: s.setMarquee,
    setDrawing: s.setDrawing,
    setDrag: s.setDrag,
    setResize: s.setResize,
    setRotation: s.setRotation,
    setPendingConnectorFromId: s.setPendingConnectorFromId,
    setDragGuides: s.setDragGuides,
    setEditingObjectId: s.setEditingObjectId,
    setTool: s.setTool,
    selection: s.selection,
    setSelection: s.setSelection,
    clearSelection: s.clearSelection,
    objects,
    objectsById,
    upsert: vi.fn(),
    upsertMany: vi.fn(),
    upsertCommentThread: vi.fn(),
    viewportRef,
    viewportRectRef,
    spaceHeldRef,
    topZRef,
    dragGuidesRef,
    anyPenActiveRef,
    wetInkApiRef,
    throttledSetCamera: props.throttledSetCamera ?? noop,
    clientToWorld: (x, y) => ({ x, y }),
    publish: noop,
    setPreviewCursor: noop,
    setActiveCommentThreadId: noop,
    addObjectAt: noop,
    pushSnapshot: noop,
    log: vi.fn(),
    logActivity: noop,
  });
  props.multiTouch?.(machine.multiTouchRef);
  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      onPointerDown={machine.onCanvasPointerDown}
      onPointerMove={machine.onCanvasPointerMove}
      onPointerUp={machine.onCanvasPointerUp}
      onPointerCancel={machine.onCanvasPointerUp}
    />
  );
}

type Finger = { pointerId: number; isPrimary: boolean };
const F1: Finger = { pointerId: 1, isPrimary: true };
const F2: Finger = { pointerId: 2, isPrimary: false };

const touch = (finger: Finger, clientX: number, clientY: number) => ({
  pointerType: "touch",
  button: 0,
  ...finger,
  clientX,
  clientY,
});

const viewport = () => screen.getByTestId("viewport");

beforeEach(() => {
  useCanvasStore.setState({
    selection: ["kept"],
    marquee: null,
    drag: null,
    resize: null,
    rotation: null,
    drawing: null,
    camera: { x: 0, y: 0, zoom: 1 },
  });
});

describe("two fingers on the board belong to the pinch", () => {
  it("select tool: no marquee between the fingers, and the selection stays", () => {
    render(<MachineHarness tool="select" />);
    // One finger on bare board starts a marquee (and clears the selection).
    fireEvent.pointerDown(viewport(), touch(F1, 50, 50));
    expect(useCanvasStore.getState().marquee).not.toBeNull();
    expect(useCanvasStore.getState().selection).toEqual([]);

    // The second finger makes it a pinch: the marquee goes, the
    // selection comes back.
    fireEvent.pointerDown(viewport(), touch(F2, 150, 50));
    expect(useCanvasStore.getState().marquee).toBeNull();
    expect(useCanvasStore.getState().selection).toEqual(["kept"]);

    // Both fingers drag across the sticky between them: nothing selects.
    for (const x of [70, 90, 110]) {
      fireEvent.pointerMove(viewport(), touch(F1, x, 60));
      fireEvent.pointerMove(viewport(), touch(F2, x + 100, 60));
    }
    fireEvent.pointerUp(viewport(), touch(F1, 110, 60));
    fireEvent.pointerUp(viewport(), touch(F2, 210, 60));
    expect(useCanvasStore.getState().marquee).toBeNull();
    expect(useCanvasStore.getState().selection).toEqual(["kept"]);
  });

  it("hand tool: the fingers don't pan over the pinch's camera", () => {
    const throttledSetCamera = vi.fn();
    render(<MachineHarness tool="hand" throttledSetCamera={throttledSetCamera} />);
    // One finger still pans.
    fireEvent.pointerDown(viewport(), touch(F1, 50, 50));
    fireEvent.pointerMove(viewport(), touch(F1, 60, 50));
    expect(throttledSetCamera).toHaveBeenCalledTimes(1);

    throttledSetCamera.mockClear();
    fireEvent.pointerDown(viewport(), touch(F2, 150, 50));
    fireEvent.pointerMove(viewport(), touch(F1, 80, 70));
    fireEvent.pointerMove(viewport(), touch(F2, 170, 70));
    fireEvent.pointerMove(viewport(), touch(F1, 100, 90));
    expect(throttledSetCamera).not.toHaveBeenCalled();
  });

  it("a fresh finger after the pinch is a one-finger gesture again; the mouse never waits", () => {
    let multiTouch: { readonly current: boolean | null } = { current: null };
    render(<MachineHarness tool="select" multiTouch={(ref) => (multiTouch = ref)} />);
    fireEvent.pointerDown(viewport(), touch(F1, 50, 50));
    fireEvent.pointerDown(viewport(), touch(F2, 150, 50));
    // Object presses read this to ignore the pinch's fingers too.
    expect(multiTouch.current).toBe(true);

    // One finger lifts; the other keeps moving: still the pinch's.
    fireEvent.pointerUp(viewport(), touch(F1, 50, 50));
    fireEvent.pointerMove(viewport(), touch(F2, 120, 80));
    expect(useCanvasStore.getState().marquee).toBeNull();
    fireEvent.pointerUp(viewport(), touch(F2, 120, 80));

    // A mouse isn't held up by the latch.
    fireEvent.pointerDown(viewport(), { pointerType: "mouse", pointerId: 9, button: 0 });
    expect(useCanvasStore.getState().marquee).not.toBeNull();
    fireEvent.pointerUp(viewport(), { pointerType: "mouse", pointerId: 9, button: 0 });
    expect(useCanvasStore.getState().marquee).toBeNull();

    // A new first finger starts a marquee again.
    fireEvent.pointerDown(viewport(), touch({ pointerId: 3, isPrimary: true }, 40, 40));
    expect(multiTouch.current).toBe(false);
    expect(useCanvasStore.getState().marquee).not.toBeNull();
  });

  it("recovers even if a lift was never seen", () => {
    render(<MachineHarness tool="select" />);
    fireEvent.pointerDown(viewport(), touch(F1, 50, 50));
    fireEvent.pointerDown(viewport(), touch(F2, 150, 50));
    // No pointerup reached us (say, the browser took the touch over).
    // The next touch is the primary one of a new sequence: it counts.
    fireEvent.pointerDown(viewport(), touch({ pointerId: 4, isPrimary: true }, 40, 40));
    expect(useCanvasStore.getState().marquee).not.toBeNull();
  });
});
