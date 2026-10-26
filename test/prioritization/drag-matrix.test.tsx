import { describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { DragMatrix, type DragMatrixItem } from "@/components/shared/drag-matrix";
import {
  atFromPointer,
  axisFraction,
  axisSplit,
  fanOut,
  nudge,
  percentAlong,
  snap,
  valueAtFraction,
  type MatrixAxis,
} from "@/lib/utils/matrix";
import { FIBONACCI_VALUES } from "@/lib/prioritization/methods/fibonacci";
import {
  VE_EFFORT_AXIS,
  VE_LABEL,
  VE_VALUE_AXIS,
  veQuadrant,
} from "@/lib/prioritization/methods/value-effort";

/**
 * The shared draggable 2×2: its axis maths (linear and the Fibonacci
 * ordinal value axis), and the component's pointer drag, keyboard moves
 * and "Place in…" picker, each saved once. The Stakeholder Map's own
 * behaviour is locked by test/tools/stakeholder-map-upgrade.test.tsx.
 */

const EFFORT: MatrixAxis = { kind: "linear", min: 1, max: 10, step: 1 };
const VALUE: MatrixAxis = { kind: "ordinal", steps: FIBONACCI_VALUES };

describe("matrix maths", () => {
  it("snaps a linear axis to its steps, within its range", () => {
    expect(snap(EFFORT, 4.4)).toBe(4);
    expect(snap(EFFORT, 0)).toBe(1);
    expect(snap(EFFORT, 99)).toBe(10);
    expect(snap({ kind: "linear", min: 0, max: 1, step: 0.1 }, 0.30000000000000004)).toBe(0.3);
    expect(snap(VALUE, 6)).toBe(5);
    expect(snap(VALUE, 7)).toBe(8);
  });

  it("spaces an ordinal axis evenly, an off-step value between its neighbours", () => {
    expect(axisFraction(VALUE, 1)).toBe(0);
    expect(axisFraction(VALUE, 8)).toBeCloseTo(4 / 6, 6);
    expect(axisFraction(VALUE, 20)).toBe(1);
    expect(axisFraction(VALUE, 4)).toBeCloseTo(2.5 / 6, 6);
    expect(valueAtFraction(VALUE, 0.5)).toBe(5);
    expect(valueAtFraction(EFFORT, 0.5)).toBe(6);
    expect(percentAlong(EFFORT, 1)).toBe(4);
    expect(percentAlong(EFFORT, 10)).toBe(96);
  });

  it("reads a pointer as the values under it (y counts up), null outside", () => {
    const rect = { left: 0, top: 0, width: 600, height: 600 };
    expect(atFromPointer(rect, 600, 0, EFFORT, VALUE)).toEqual({ x: 10, y: 20 });
    expect(atFromPointer(rect, 0, 600, EFFORT, VALUE)).toEqual({ x: 1, y: 1 });
    expect(atFromPointer(rect, 300, 300, EFFORT, VALUE)).toEqual({ x: 6, y: 5 });
    expect(atFromPointer(rect, -1, 10, EFFORT, VALUE)).toBeNull();
    expect(atFromPointer({ ...rect, width: 0 }, 1, 1, EFFORT, VALUE)).toBeNull();
  });

  it("steps by the axis, an unplaced axis starting mid-way, an off-step value to the next step", () => {
    expect(nudge(EFFORT, 3, 1)).toBe(4);
    expect(nudge(EFFORT, 9, 3)).toBe(10);
    expect(nudge(EFFORT, null, 1)).toBe(7);
    expect(nudge(VALUE, 5, 1)).toBe(8);
    expect(nudge(VALUE, 20, 3)).toBe(20);
    expect(nudge(VALUE, null, 1)).toBe(8);
    expect(nudge(VALUE, 4, 1)).toBe(5);
    expect(nudge(VALUE, 4, -1)).toBe(3);
  });

  it("divides the panes where the quadrant changes, so a drop lands in the pane it reads", () => {
    // No highFrom: the middle (the Stakeholder Map's 50/50).
    expect(axisSplit(EFFORT)).toBe(0.5);
    expect(axisSplit(VALUE)).toBe(0.5);
    // Effort 1–10, high from 6: still the middle. Value, high from 8: 3.5 of 6 steps up.
    expect(axisSplit(VE_EFFORT_AXIS)).toBeCloseTo(0.5, 9);
    expect(axisSplit(VE_VALUE_AXIS)).toBeCloseTo(3.5 / 6, 9);
    expect(axisSplit({ ...VE_VALUE_AXIS, highFrom: 1 })).toBe(0);
    expect(axisSplit({ ...VE_VALUE_AXIS, highFrom: 40 })).toBe(1);
    // A drop just above the drawn value divider is high value, just below it low.
    const rect = { left: 0, top: 0, width: 600, height: 600 };
    const line = 600 * (1 - 3.5 / 6);
    const above = atFromPointer(rect, 120, line - 2, VE_EFFORT_AXIS, VE_VALUE_AXIS)!;
    const below = atFromPointer(rect, 120, line + 2, VE_EFFORT_AXIS, VE_VALUE_AXIS)!;
    expect(above.y).toBe(8);
    expect(veQuadrant(above.y, above.x)).toBe("quick_wins");
    expect(below.y).toBe(5);
    expect(veQuadrant(below.y, below.x)).toBe("fill_ins");
    // And value 5's dot is drawn below the line, not on it.
    expect(percentAlong(VE_VALUE_AXIS, 5)).toBeLessThan((3.5 / 6) * 100);
    expect(percentAlong(VE_VALUE_AXIS, 8)).toBeGreaterThan((3.5 / 6) * 100);
  });

  it("fans out dots on one spot, the first carrying the count", () => {
    const f = fanOut([
      { id: "a", x: 1, y: 1 },
      { id: "b", x: 1, y: 1 },
      { id: "c", x: 2, y: 1 },
    ]);
    expect(f.get("a")).toEqual({ dx: 0, dy: 0, count: 2, first: true });
    expect(f.get("b")).toEqual({ dx: 0, dy: 8, count: 2, first: false });
    expect(f.get("c")).toMatchObject({ count: 1, first: true });
  });
});

describe("<DragMatrix>", () => {
  type Item = DragMatrixItem & { name: string };
  const positionText = (at: { x: number | null; y: number | null }) => {
    const q = veQuadrant(at.y, at.x);
    return q ? `value ${at.y}, effort ${at.x}, ${VE_LABEL[q]}` : "not placed yet";
  };

  const renderMatrix = (
    items: Item[],
    axes: { x: MatrixAxis; y: MatrixAxis } = { x: EFFORT, y: VALUE }
  ) => {
    const onPlace = vi.fn();
    render(
      <LiveAnnouncerProvider>
        <DragMatrix<Item>
          items={items}
          xAxis={axes.x}
          yAxis={axes.y}
          yLabel="↑ Value"
          xLabel="Effort →"
          label="Value vs Effort matrix"
          help="Drag a dot, or use the arrow keys."
          panes={[
            { id: "quick_wins", label: "Quick Wins", className: "bg-success/5 text-success" },
            {
              id: "big_bets",
              label: "Big Bets",
              className: "bg-accent/10 text-accent",
              align: "right",
            },
            { id: "fill_ins", label: "Fill-Ins", className: "bg-bg text-sub" },
            {
              id: "time_wasters",
              label: "Time Wasters",
              className: "bg-danger/5 text-danger",
              align: "right",
            },
          ]}
          places={[{ id: "quick_wins", label: "Quick Wins", at: { x: 3, y: 13 } }]}
          positionText={positionText}
          itemName={(i) => i.name}
          dotClass={() => "bg-accent"}
          onPlace={onPlace}
        />
      </LiveAnnouncerProvider>
    );
    const grid = screen.getByRole("group", { name: "Value vs Effort matrix" });
    grid.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 600,
        height: 600,
        right: 600,
        bottom: 600,
        x: 0,
        y: 0,
      }) as DOMRect;
    return { onPlace, grid };
  };

  it("drags a dot and saves one move on release", () => {
    const { onPlace, grid } = renderMatrix([{ id: "a", name: "Search", x: 3, y: 2 }]);
    const dot = within(grid).getByRole("button", { name: "Search: value 2, effort 3, Fill-Ins" });
    fireEvent.pointerDown(dot, { pointerId: 1, button: 0, clientX: 133, clientY: 500 });
    fireEvent.pointerMove(dot, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(dot, { pointerId: 1, clientX: 600, clientY: 0 });
    expect(onPlace).not.toHaveBeenCalled();
    fireEvent.pointerUp(dot, { pointerId: 1, clientX: 600, clientY: 0 });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("a", { x: 10, y: 20 }, "drag");
  });

  it("draws the panes 50/50 by default and at the high-value line on the Fibonacci axis", () => {
    const panes = (grid: HTMLElement) =>
      grid.querySelector<HTMLElement>("[style*='grid-template-rows']")!.style;
    const even = renderMatrix([]).grid;
    expect(panes(even).gridTemplateColumns).toBe("minmax(0, 0.5fr) minmax(0, 0.5fr)");
    expect(panes(even).gridTemplateRows).toBe("minmax(0, 0.5fr) minmax(0, 0.5fr)");
    cleanup();
    const { grid, onPlace } = renderMatrix([{ id: "a", name: "Search", x: 3, y: 2 }], {
      x: VE_EFFORT_AXIS,
      y: VE_VALUE_AXIS,
    });
    const top = 1 - 3.5 / 6;
    expect(panes(grid).gridTemplateRows).toBe("minmax(0, 0.4167fr) minmax(0, 0.5833fr)");
    expect(panes(grid).gridTemplateColumns).toBe("minmax(0, 0.5fr) minmax(0, 0.5fr)");
    // A drop just above that line, in the upper panes, saves a high value.
    const dot = within(grid).getByRole("button", { name: /^Search:/ });
    fireEvent.pointerDown(dot, { pointerId: 1, button: 0, clientX: 133, clientY: 500 });
    fireEvent.pointerMove(dot, { pointerId: 1, clientX: 120, clientY: 600 * top - 2 });
    fireEvent.pointerUp(dot, { pointerId: 1, clientX: 120, clientY: 600 * top - 2 });
    expect(onPlace).toHaveBeenCalledWith("a", { x: 3, y: 8 }, "drag");
  });

  it("treats a short pointer move as a tap, saving nothing", () => {
    const { onPlace, grid } = renderMatrix([{ id: "a", name: "Search", x: 3, y: 2 }]);
    const dot = within(grid).getByRole("button", { name: /^Search:/ });
    fireEvent.pointerDown(dot, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(dot, { pointerId: 1, clientX: 102, clientY: 101 });
    fireEvent.pointerUp(dot, { pointerId: 1, clientX: 102, clientY: 101 });
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("moves with the arrow keys along the Fibonacci steps, announced, saved once on blur", async () => {
    const { onPlace, grid } = renderMatrix([{ id: "a", name: "Search", x: 3, y: 5 }]);
    const dot = within(grid).getByRole("button", { name: /^Search:/ });
    act(() => dot.focus());
    fireEvent.keyDown(dot, { key: "ArrowUp" });
    fireEvent.keyDown(dot, { key: "ArrowRight", shiftKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Search: value 8, effort 6, Big Bets"
      )
    );
    expect(onPlace).not.toHaveBeenCalled();
    fireEvent.blur(dot);
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("a", { x: 6, y: 8 }, "keys");
  });

  it("saves on Enter, and a move back to where it was saves nothing", () => {
    const { onPlace, grid } = renderMatrix([{ id: "a", name: "Search", x: 3, y: 5 }]);
    const dot = within(grid).getByRole("button", { name: /^Search:/ });
    fireEvent.keyDown(dot, { key: "ArrowDown" });
    fireEvent.keyDown(dot, { key: "Enter" });
    expect(onPlace).toHaveBeenCalledWith("a", { x: 3, y: 3 }, "keys");
    onPlace.mockClear();
    fireEvent.keyDown(dot, { key: "ArrowUp" });
    fireEvent.keyDown(dot, { key: "ArrowDown" });
    fireEvent.keyDown(dot, { key: "Enter" });
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("lists unplaced items in the tray, with a picker and a drag onto the map", () => {
    const { onPlace, grid } = renderMatrix([
      { id: "a", name: "Search", x: null, y: null },
      { id: "b", name: "Export", x: null, y: null },
    ]);
    const tray = screen.getByRole("region", { name: "Not placed yet" });
    expect(within(tray).getByText("Not placed yet (2)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Place Search in"), { target: { value: "quick_wins" } });
    expect(onPlace).toHaveBeenCalledWith("a", { x: 3, y: 13 }, "pick");
    const chip = screen.getByRole("button", { name: /^Export: not placed yet/ });
    fireEvent.pointerDown(chip, { pointerId: 2, button: 0, clientX: -50, clientY: -50 });
    fireEvent.pointerMove(chip, { pointerId: 2, clientX: 0, clientY: 600 });
    fireEvent.pointerUp(chip, { pointerId: 2, clientX: 0, clientY: 600 });
    expect(onPlace).toHaveBeenLastCalledWith("b", { x: 1, y: 1 }, "drag");
    expect(within(grid).queryAllByRole("button")).toHaveLength(0);
  });
});
