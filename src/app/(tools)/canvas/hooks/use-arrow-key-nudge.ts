"use client";

import { useEffect } from "react";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

/**
 * Arrow-key nudge — independent of `makeShortcutHandler` because that
 * shortcut model doesn't carry direction.
 *
 * OS auto-repeat fires keydown ~30 Hz on typical settings. Without
 * batching we'd dispatch one upsertMany per event, causing 30 store
 * mutations / sec — each one triggering the realtime broadcast
 * listener, the workspace-store subscribers, and a full re-render of
 * every selected object. We accumulate the deltas into a single
 * animation-frame and flush once per frame so the move feels smooth
 * but the store sees at most ~60 updates / sec regardless of repeat
 * rate.
 *
 * Skipped entirely in read-only mode and while a presentation is
 * active (presentation mode owns the arrow keys for frame navigation).
 */
export function useArrowKeyNudge(params: {
  selection: readonly string[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  upsertMany: (objs: WhiteboardObject[]) => void;
  readOnly: boolean;
  presentationFrameIndex: number | null;
}) {
  const { selection, objectsById, upsertMany, readOnly, presentationFrameIndex } = params;

  useEffect(() => {
    let pendingDx = 0;
    let pendingDy = 0;
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (pendingDx === 0 && pendingDy === 0) return;
      const dx = pendingDx;
      const dy = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      const updates: WhiteboardObject[] = [];
      for (const id of selection) {
        const o = objectsById.get(id);
        if (!o) continue;
        // Bump version so peers receive the nudge — see C14.
        updates.push({ ...o, x: o.x + dx, y: o.y + dy, version: o.version + 1, updatedAt: new Date().toISOString() });
      }
      if (updates.length > 0) upsertMany(updates);
    };
    const onKey = (e: KeyboardEvent) => {
      // ReadOnly: viewer / commenter modes cannot nudge.
      if (readOnly) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (selection.length === 0) return;
      // Don't fight with presentation-mode frame navigation — when the
      // user is in presentation mode, arrow keys cycle frames instead
      // of nudging selection.
      if (presentationFrameIndex !== null) return;
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      pendingDx += dx;
      pendingDy += dy;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [selection, objectsById, upsertMany, readOnly, presentationFrameIndex]);
}
