import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useStableOrder } from "@/hooks/use-stable-order";
import { ResortChip } from "@/components/shared/resort-chip";

/**
 * A ranked list that doesn't jump mid-edit: editing a score only marks the
 * order stale; adding or removing an item, or "Re-sort", sorts again.
 */

type Row = { id: string; score: number };
const byScore = (a: Row, b: Row) => b.score - a.score;
const keyOf = (r: Row) => r.id;
const ids = (rows: Row[]) => rows.map((r) => r.id);

function setup(initial: Row[]) {
  return renderHook(({ items }) => useStableOrder(items, keyOf, byScore), {
    initialProps: { items: initial },
  });
}

describe("useStableOrder", () => {
  it("sorts on first render", () => {
    const { result } = setup([
      { id: "a", score: 1 },
      { id: "b", score: 3 },
    ]);
    expect(ids(result.current.ordered)).toEqual(["b", "a"]);
    expect(result.current.isStale).toBe(false);
  });

  it("keeps rows in place while a score changes, and flags the order stale", () => {
    const { result, rerender } = setup([
      { id: "a", score: 3 },
      { id: "b", score: 2 },
    ]);
    rerender({
      items: [
        { id: "a", score: 1 },
        { id: "b", score: 2 },
      ],
    });
    expect(ids(result.current.ordered)).toEqual(["a", "b"]);
    // The edited values still show.
    expect(result.current.ordered[0].score).toBe(1);
    expect(result.current.isStale).toBe(true);

    act(() => result.current.resort());
    expect(ids(result.current.ordered)).toEqual(["b", "a"]);
    expect(result.current.isStale).toBe(false);
  });

  it("re-sorts when an item is added or removed", () => {
    const { result, rerender } = setup([
      { id: "a", score: 3 },
      { id: "b", score: 2 },
    ]);
    rerender({
      items: [
        { id: "a", score: 1 },
        { id: "b", score: 2 },
        { id: "c", score: 5 },
      ],
    });
    expect(ids(result.current.ordered)).toEqual(["c", "b", "a"]);

    rerender({ items: [{ id: "a", score: 1 }] });
    expect(ids(result.current.ordered)).toEqual(["a"]);
  });

  it("handles an empty list", () => {
    const { result } = setup([]);
    expect(result.current.ordered).toEqual([]);
    expect(result.current.isStale).toBe(false);
  });
});

describe("ResortChip", () => {
  it("offers Re-sort only while the order is stale", () => {
    const onResort = vi.fn();
    const { rerender } = render(<ResortChip isStale={false} onResort={onResort} />);
    expect(screen.queryByRole("button", { name: "Re-sort" })).not.toBeInTheDocument();
    // The live region is always there, so the message is announced when it appears.
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(<ResortChip isStale onResort={onResort} what="Ratings" />);
    expect(screen.getByRole("status")).toHaveTextContent("Ratings changed since the last sort.");
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(onResort).toHaveBeenCalledTimes(1);
  });
});
