/**
 * useTimeTravel must NOT re-render a consumer when an UNRELATED tool's history
 * changes. The registry's global version counter bumps on any tool's
 * snapshot/undo/redo; embedding it in the snapshot string re-rendered every
 * consumer. The snapshot now keys on this tool's own canUndo|canRedo|
 * pastLength, so an unrelated bump leaves the returned object reference stable.
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTimeTravel } from "@/lib/stores/use-time-travel";
import { timeTravelRegistry, type TimeTravelControls } from "@/lib/stores/with-time-travel";

function fakeControls(state: { past: number; canU: boolean; canR: boolean }): TimeTravelControls {
  return {
    canUndo: () => state.canU,
    canRedo: () => state.canR,
    pastLength: () => state.past,
    undo: () => {},
    redo: () => {},
    clear: () => {},
    jumpTo: () => {},
    futureLength: () => 0,
    label: () => null,
  } as unknown as TimeTravelControls;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("useTimeTravel", () => {
  it("does not re-render when an unrelated tool's version bumps", () => {
    const a = { past: 0, canU: false, canR: false };
    cleanups.push(timeTravelRegistry.register("toolA", fakeControls(a)));
    cleanups.push(
      timeTravelRegistry.register("toolB", fakeControls({ past: 0, canU: false, canR: false }))
    );

    const { result } = renderHook(() => useTimeTravel("toolA"));
    const first = result.current;
    expect(first.available).toBe(true);

    // Simulate toolB doing an undo/redo/snapshot → global version bumps, but
    // toolA's affordance is unchanged.
    act(() => timeTravelRegistry.bump());
    expect(result.current).toBe(first); // same object reference → no re-render
  });

  it("re-renders when THIS tool's own history changes", () => {
    const a = { past: 0, canU: false, canR: false };
    cleanups.push(timeTravelRegistry.register("toolA", fakeControls(a)));

    const { result } = renderHook(() => useTimeTravel("toolA"));
    const first = result.current;

    // toolA pushes a snapshot: pastLength + canUndo change, then version bumps.
    act(() => {
      a.past = 1;
      a.canU = true;
      timeTravelRegistry.bump();
    });
    expect(result.current).not.toBe(first);
    expect(result.current.pastLength).toBe(1);
    expect(result.current.canUndo).toBe(true);
  });
});
