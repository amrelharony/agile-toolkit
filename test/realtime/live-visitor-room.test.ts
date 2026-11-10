// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enterLiveVisitorRoom,
  inLiveVisitorRoom,
  subscribeLiveVisitorRoom,
} from "@/lib/realtime/live-visitor-room";

/**
 * The marker for "this tab is in a visitor live room": a count of open rooms
 * with a leave function per room, and a listener list for
 * useSyncExternalStore. Node has no localStorage, so this is the tab's own
 * count alone, which must work without it. The stamp the other tabs read is
 * in live-visitor-room-tabs.test.ts.
 */

const leaves: Array<() => void> = [];
/** Enter a room and remember its leave function, so no test hands a mark on. */
function enter(): () => void {
  const leave = enterLiveVisitorRoom();
  leaves.push(leave);
  return leave;
}

afterEach(() => {
  for (const leave of leaves.splice(0)) leave();
  expect(inLiveVisitorRoom()).toBe(false);
});

describe("live visitor room marker", () => {
  it("is off until a room opens and off again once it closes", () => {
    expect(inLiveVisitorRoom()).toBe(false);
    const leave = enter();
    expect(inLiveVisitorRoom()).toBe(true);
    leave();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("stays on until every open room has closed", () => {
    const first = enter();
    const second = enter();
    first();
    expect(inLiveVisitorRoom()).toBe(true);
    second();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("counts a leave once, however often it is called", () => {
    const first = enter();
    const second = enter();
    first();
    first();
    first();
    // A second count would have closed the other room too.
    expect(inLiveVisitorRoom()).toBe(true);
    second();
    expect(inLiveVisitorRoom()).toBe(false);
  });

  it("tells listeners when a room opens or closes, with the new value in place", () => {
    const seen: boolean[] = [];
    const stop = subscribeLiveVisitorRoom(() => seen.push(inLiveVisitorRoom()));
    const leave = enter();
    leave();
    leave();
    expect(seen).toEqual([true, false]);
    stop();
  });

  it("stops telling a listener that unsubscribed", () => {
    const listener = vi.fn();
    const stop = subscribeLiveVisitorRoom(listener);
    stop();
    enter()();
    expect(listener).not.toHaveBeenCalled();
  });

  it("lets a listener unsubscribe while it is being told", () => {
    const other = vi.fn();
    const stop = subscribeLiveVisitorRoom(() => stop());
    const stopOther = subscribeLiveVisitorRoom(other);
    enter();
    expect(other).toHaveBeenCalledTimes(1);
    stopOther();
  });
});
