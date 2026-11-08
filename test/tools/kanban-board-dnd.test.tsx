import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

/**
 * The Kanban boards' drag and drop on a phone. The overlay that follows the
 * finger is portalled to <body>, so no transformed ancestor (the tool page's
 * entrance animation) can become its containing block and draw it
 * off-screen.
 */

vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));

import { BoardDnd, DragPreview, DraggableCard, DropColumn } from "@/app/(tools)/kanban/board-dnd";

function Board({ onMove = () => {} }: { onMove?: (id: string, col: string) => void }) {
  return (
    <div data-testid="page" className="container-tool motion-safe:animate-rise">
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
});
