import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { DndContextProps } from "@dnd-kit/core";

/**
 * The Kanban boards' drag and drop on a phone. The overlay that follows the
 * finger is portalled to <body>, so no transformed ancestor (the tool page's
 * entrance animation) can become its containing block and draw it
 * off-screen. For the length of a drag the lanes' swipe row stops snapping,
 * so dnd-kit's auto-scroll moves smoothly instead of jumping a lane per
 * step, and touch screens get a gentler auto-scroll than dnd-kit's default.
 */

const seen = vi.hoisted(() => ({ props: [] as DndContextProps[] }));
vi.mock("@/lib/sonification/sonified-dnd-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sonification/sonified-dnd-context")>();
  return {
    SonifiedDndContext: (props: DndContextProps) => {
      seen.props.push(props);
      return <actual.SonifiedDndContext {...props} />;
    },
  };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));

import { BoardDnd, DragPreview, DraggableCard, DropColumn } from "@/app/(tools)/kanban/board-dnd";

function Board({ onMove = () => {} }: { onMove?: (id: string, col: string) => void }) {
  return (
    <div data-testid="page" className="container-tool isolate motion-safe:animate-rise">
      <BoardDnd
        onMove={onMove}
        titleOf={(id) => `Card ${id}`}
        renderOverlay={(id) => <DragPreview title={`Dragging ${id}`} />}
      >
        <div data-testid="lanes" className="scroll-x-snap">
          <DropColumn id="backlog">
            <DraggableCard id="a">
              {(grip) => (
                <div>
                  {grip}
                  <span>Card a</span>
                </div>
              )}
            </DraggableCard>
          </DropColumn>
          <DropColumn id="ready">
            <p>Ready lane</p>
          </DropColumn>
        </div>
      </BoardDnd>
    </div>
  );
}

function grip(): HTMLElement {
  const el = screen.getByTestId("page").querySelector<HTMLElement>("span.cursor-grab");
  if (!el) throw new Error("no grip");
  return el;
}

/** Press the grip and travel past the 6 px activation distance. */
function startDrag() {
  fireEvent.pointerDown(grip(), { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  act(() => {
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 40, clientY: 30 });
  });
}

function endDrag() {
  act(() => {
    fireEvent.pointerUp(document, { isPrimary: true, clientX: 40, clientY: 30 });
  });
}

afterEach(() => {
  seen.props = [];
  vi.restoreAllMocks();
});

describe("Kanban board drag and drop", () => {
  it("renders the drag overlay under <body>, outside the tool page", async () => {
    render(<Board />);
    startDrag();
    const preview = screen.getByText("Dragging a");
    expect(document.body.contains(preview)).toBe(true);
    expect(screen.getByTestId("page").contains(preview)).toBe(false);
    endDrag();
    // dnd-kit lets go of the overlay a microtask after the drop.
    await waitFor(() => expect(screen.queryByText("Dragging a")).toBeNull());
  });

  it("server-renders without the overlay (no <body> to portal into)", () => {
    const html = renderToString(<Board />);
    expect(html).toContain("Card a");
    expect(html).not.toContain("Dragging a");
  });

  it("stops the lanes snapping while a card is dragged, then puts the snap back", () => {
    render(<Board />);
    const lanes = screen.getByTestId("lanes");
    lanes.style.setProperty("scroll-snap-type", "x mandatory");
    startDrag();
    expect(lanes.style.getPropertyValue("scroll-snap-type")).toBe("none");
    endDrag();
    expect(lanes.style.getPropertyValue("scroll-snap-type")).toBe("x mandatory");
  });

  it("puts the snap back if the board goes away mid-drag", () => {
    const { unmount } = render(<Board />);
    const lanes = screen.getByTestId("lanes");
    lanes.style.setProperty("scroll-snap-type", "x mandatory");
    startDrag();
    expect(lanes.style.getPropertyValue("scroll-snap-type")).toBe("none");
    unmount();
    expect(lanes.style.getPropertyValue("scroll-snap-type")).toBe("x mandatory");
  });

  it("leaves elements that don't snap alone", () => {
    render(<Board />);
    startDrag();
    expect(screen.getByTestId("lanes").getAttribute("style")).toBeNull();
    expect(screen.getByTestId("page").getAttribute("style")).toBeNull();
    endDrag();
  });

  it("keeps dnd-kit's auto-scroll defaults for a mouse", () => {
    render(<Board />);
    expect(seen.props.at(-1)?.autoScroll).toBe(true);
  });

  it("gives touch screens a narrower side zone and a slower auto-scroll", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(pointer: coarse)",
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList
    );
    render(<Board />);
    expect(seen.props.at(-1)?.autoScroll).toEqual({
      threshold: { x: 0.1, y: 0.2 },
      acceleration: 5,
    });
  });
});
