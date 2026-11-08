import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * The drag flag the moment scheduler reads: <SonifiedDndContext> raises it
 * for the length of a drag (end or cancel lowers it), it counts nested
 * boards, and a drag whose end never came stops counting after a minute.
 */

const h = vi.hoisted(() => ({ props: null as Record<string, (e: unknown) => void> | null }));

vi.mock("@dnd-kit/core", () => ({
  DndContext: (props: Record<string, (e: unknown) => void>) => {
    h.props = props;
    return null;
  },
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: vi.fn() }));

import { SonifiedDndContext } from "@/lib/sonification/sonified-dnd-context";
import {
  DRAG_STALE_MS,
  __resetDragFlagForTests,
  isDragInProgress,
  markDragEnd,
  markDragStart,
} from "@/lib/sonification/drag-flag";

beforeEach(() => {
  __resetDragFlagForTests();
  h.props = null;
});

describe("drag flag", () => {
  it("SonifiedDndContext raises it on drag start and lowers it on end or cancel", () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const onDragCancel = vi.fn();
    render(
      <SonifiedDndContext
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      />
    );
    expect(isDragInProgress()).toBe(false);
    h.props!.onDragStart({});
    expect(isDragInProgress()).toBe(true);
    h.props!.onDragEnd({ over: null });
    expect(isDragInProgress()).toBe(false);
    h.props!.onDragStart({});
    h.props!.onDragCancel({});
    expect(isDragInProgress()).toBe(false);
    expect(onDragStart).toHaveBeenCalledTimes(2);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragCancel).toHaveBeenCalledTimes(1);
  });

  it("counts two boards, never goes negative, and forgets a stale drag", () => {
    markDragStart(1000);
    markDragStart(1000);
    markDragEnd();
    expect(isDragInProgress(1000)).toBe(true);
    markDragEnd();
    markDragEnd();
    expect(isDragInProgress(1000)).toBe(false);
    markDragStart(1000);
    expect(isDragInProgress(1000 + DRAG_STALE_MS + 1)).toBe(false);
    expect(isDragInProgress(1000)).toBe(false);
  });
});
