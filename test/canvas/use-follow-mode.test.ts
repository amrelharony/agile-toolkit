/**
 * useFollowMode must snap the camera ONLY when the followed peer's viewport
 * changes — not on every unrelated presence update. `members` changes identity
 * on every peer's cursor/presence broadcast; keying the effect on the whole
 * array re-snapped the camera continuously, pinning the user and fighting any
 * local pan.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFollowMode } from "@/app/(tools)/canvas/hooks/use-follow-mode";

type Peer = { id: string; viewport?: { x: number; y: number; zoom: number } };

describe("useFollowMode", () => {
  it("snaps once on mount to the followed peer's viewport", () => {
    const setCamera = vi.fn();
    renderHook(() =>
      useFollowMode("peer1", [{ id: "peer1", viewport: { x: 1, y: 2, zoom: 3 } }], setCamera)
    );
    expect(setCamera).toHaveBeenCalledTimes(1);
    expect(setCamera).toHaveBeenCalledWith({ x: 1, y: 2, zoom: 3 });
  });

  it("does NOT re-snap when an unrelated peer's presence changes", () => {
    const setCamera = vi.fn();
    const { rerender } = renderHook(({ members }) => useFollowMode("peer1", members, setCamera), {
      initialProps: {
        members: [{ id: "peer1", viewport: { x: 1, y: 2, zoom: 3 } }] as Peer[],
      },
    });
    expect(setCamera).toHaveBeenCalledTimes(1);

    // New `members` array identity (peer2 moved its cursor), but peer1's
    // viewport is unchanged → camera must stay put.
    rerender({
      members: [
        { id: "peer1", viewport: { x: 1, y: 2, zoom: 3 } },
        { id: "peer2", viewport: { x: 99, y: 99, zoom: 9 } },
      ],
    });
    expect(setCamera).toHaveBeenCalledTimes(1);
  });

  it("re-snaps when the followed peer's viewport actually changes", () => {
    const setCamera = vi.fn();
    const { rerender } = renderHook(({ members }) => useFollowMode("peer1", members, setCamera), {
      initialProps: {
        members: [{ id: "peer1", viewport: { x: 1, y: 2, zoom: 3 } }] as Peer[],
      },
    });
    expect(setCamera).toHaveBeenCalledTimes(1);

    rerender({ members: [{ id: "peer1", viewport: { x: 10, y: 20, zoom: 3 } }] });
    expect(setCamera).toHaveBeenCalledTimes(2);
    expect(setCamera).toHaveBeenLastCalledWith({ x: 10, y: 20, zoom: 3 });
  });

  it("does nothing when not following", () => {
    const setCamera = vi.fn();
    renderHook(() =>
      useFollowMode(null, [{ id: "peer1", viewport: { x: 1, y: 2, zoom: 3 } }], setCamera)
    );
    expect(setCamera).not.toHaveBeenCalled();
  });
});
