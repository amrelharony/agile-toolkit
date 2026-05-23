"use client";

import { useEffect, useRef, useState } from "react";
import { fitToRects } from "@/lib/whiteboard/canvas-transform";
import type { Camera, Rect } from "@/lib/geometry/bbox";

type RemoteFocus = { kind: "snap" | "spotlight"; rect: Rect } | null;

/**
 * Consumer for `remoteFocus` broadcasts from `useCanvasRoom`.
 *
 *  - `snap` mode: fit-to-rect on the local viewport so each peer
 *    teleports to the focused area. Latched on the focus event so
 *    a window-resize doesn't re-snap the same event on every size
 *    change (which would clobber the user's local pan).
 *
 *  - `spotlight` mode: just store the rect; the camera stays put.
 *    The parent renders a `<SpotlightCutout>` overlay highlighting
 *    the area on every peer's screen without moving them.
 *
 * Returns the current spotlight rect (null when no spotlight is
 * active or when we're in snap mode).
 */
export function useRemoteFocusReceiver(params: {
  remoteFocus: RemoteFocus;
  size: { w: number; h: number };
  setCamera: (cam: Camera) => void;
}): Rect | null {
  const { remoteFocus, size, setCamera } = params;
  const [spotlightRect, setSpotlightRect] = useState<Rect | null>(null);
  const lastAppliedFocusRef = useRef<unknown>(null);

  useEffect(() => {
    if (!remoteFocus) {
      setSpotlightRect(null);
      lastAppliedFocusRef.current = null;
      return;
    }
    if (remoteFocus.kind === "snap") {
      if (lastAppliedFocusRef.current === remoteFocus) {
        // Already snapped to this focus event; ignore size changes so
        // a window resize doesn't overwrite the user's local pan.
        return;
      }
      if (size.w > 0 && size.h > 0) {
        const cam = fitToRects([remoteFocus.rect], size.w, size.h, 0.15);
        if (cam) setCamera(cam);
        lastAppliedFocusRef.current = remoteFocus;
      }
      setSpotlightRect(null);
    } else {
      setSpotlightRect(remoteFocus.rect);
    }
  }, [remoteFocus, size.w, size.h, setCamera]);

  return spotlightRect;
}
