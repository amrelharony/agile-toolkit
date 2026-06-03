"use client";

import { useEffect } from "react";
import type { Camera } from "@/lib/geometry/bbox";

type PeerLike = {
  id: string;
  viewport?: { x: number; y: number; zoom: number } | undefined;
};

/**
 * Follow-user: when `followUserId` is set, keep the local camera
 * synced to that peer's viewport. A locally-initiated pan/zoom (via
 * onCanvasPointer*) does NOT clear the follow latch — that's done via
 * `setFollowUserId(null)` when the user clicks the follow button again.
 *
 * The effect keys on the followed peer's viewport SCALARS, not the whole
 * `members` array. `members` changes identity on EVERY peer's presence
 * broadcast (cursor moves included), so depending on it re-snapped the
 * camera to the followed peer on every unrelated presence update — pinning
 * the user and fighting any local pan/zoom they attempted.
 */
export function useFollowMode<P extends PeerLike>(
  followUserId: string | null,
  members: readonly P[],
  setCamera: (cam: Camera) => void
) {
  const followed = followUserId ? members.find((m) => m.id === followUserId) : undefined;
  const x = followed?.viewport?.x;
  const y = followed?.viewport?.y;
  const zoom = followed?.viewport?.zoom;
  useEffect(() => {
    if (!followUserId) return;
    if (x === undefined || y === undefined || zoom === undefined) return;
    setCamera({ x, y, zoom });
  }, [followUserId, x, y, zoom, setCamera]);
}
