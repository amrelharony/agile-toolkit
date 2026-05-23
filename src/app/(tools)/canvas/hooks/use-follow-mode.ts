"use client";

import { useEffect } from "react";
import type { Camera } from "@/lib/geometry/bbox";

type PeerLike = {
  id: string;
  viewport?: { x: number; y: number; zoom: number } | undefined;
};

/**
 * Follow-user: when `followUserId` is set, keep the local camera
 * synced to that peer's viewport. The presence layer broadcasts
 * viewport on every change, so this effect re-runs and snaps our
 * camera. A locally-initiated pan/zoom (via onCanvasPointer*) does
 * NOT clear the follow latch — that's done via `setFollowUserId(null)`
 * when the user clicks the follow button again.
 */
export function useFollowMode<P extends PeerLike>(
  followUserId: string | null,
  members: readonly P[],
  setCamera: (cam: Camera) => void,
) {
  useEffect(() => {
    if (!followUserId) return;
    const peer = members.find((m) => m.id === followUserId);
    if (!peer || !peer.viewport) return;
    setCamera({ x: peer.viewport.x, y: peer.viewport.y, zoom: peer.viewport.zoom });
  }, [followUserId, members, setCamera]);
}
