"use client";

import { useEffect, useRef, type RefObject } from "react";
import { translateFlatPoints } from "@/lib/whiteboard/freehand";
import { controlOwnsKey, isInsideScope } from "@/lib/whiteboard/keyboard";
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
 *
 * Only while focus is on the board, and never when the focused control
 * uses the arrows itself (a select, slider or radio group): the window
 * listener used to move the selection while the user was changing a
 * value elsewhere on the page.
 */
export function useArrowKeyNudge(params: {
  selection: readonly string[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  upsertMany: (objs: WhiteboardObject[]) => void;
  /** Push an undo snapshot. Called once per gesture (the first key in a
   *  burst); subsequent keys before key-up coalesce into the same undo
   *  entry. Without this, arrow-nudging bypassed undo entirely — holding
   *  arrow for a few seconds was unrecoverable. */
  pushSnapshot: () => void;
  readOnly: boolean;
  presentationFrameIndex: number | null;
  /** The focusable board element (role="application"). */
  viewportRef: RefObject<HTMLElement | null>;
}) {
  const {
    selection,
    objectsById,
    upsertMany,
    pushSnapshot,
    readOnly,
    presentationFrameIndex,
    viewportRef,
  } = params;
  // Track gesture state via refs so the keydown handler stays stable.
  // `gesturePushedRef` flips on the first arrow-down of a gesture; the
  // keyup handler resets it so the NEXT gesture pushes a fresh snapshot.
  const gesturePushedRef = useRef(false);

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
        // Locked objects stay put, as they do for drag and align.
        if (!o || o.locked) continue;
        // Bump version so peers receive the nudge — see C14.
        // Freehand ink lives in world-absolute `points` — translate
        // them with the bbox or the nudge moves the box, not the ink.
        // Branched ternary (not a conditional spread) so TS keeps the
        // per-type narrowing — `card` has a numeric `points` field.
        updates.push(
          o.type === "freehand"
            ? {
                ...o,
                x: o.x + dx,
                y: o.y + dy,
                points: translateFlatPoints(o.points, dx, dy),
                version: o.version + 1,
                updatedAt: new Date().toISOString(),
              }
            : {
                ...o,
                x: o.x + dx,
                y: o.y + dy,
                version: o.version + 1,
                updatedAt: new Date().toISOString(),
              }
        );
      }
      if (updates.length > 0) upsertMany(updates);
    };
    const onKey = (e: KeyboardEvent) => {
      // ReadOnly: viewer / commenter modes cannot nudge.
      if (readOnly) return;
      if (!isInsideScope(e.target, viewportRef.current)) return;
      if (controlOwnsKey(e.target, e.key)) return;
      // Nothing to move (an empty selection, or only locked objects): leave
      // the key alone and record no undo step.
      const movable = selection.some((id) => {
        const o = objectsById.get(id);
        return o !== undefined && !o.locked;
      });
      if (!movable) return;
      // Don't fight with presentation-mode frame navigation — when the
      // user is in presentation mode, arrow keys cycle frames instead
      // of nudging selection.
      if (presentationFrameIndex !== null) return;
      const step = e.shiftKey ? 10 : 1;
      let dx = 0,
        dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      // First arrow-down of a gesture: snapshot for undo. Subsequent
      // keys before the matching keyup coalesce into the same entry,
      // so Cmd+Z reverts the entire nudge burst — not one pixel at a time.
      if (!gesturePushedRef.current) {
        pushSnapshot();
        gesturePushedRef.current = true;
      }
      pendingDx += dx;
      pendingDy += dy;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // Reset gesture once any arrow key is released. Cheap heuristic:
      // OS auto-repeat fires keydown without keyup, so a single keyup
      // marks the end of the burst.
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        gesturePushedRef.current = false;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [
    selection,
    objectsById,
    upsertMany,
    pushSnapshot,
    readOnly,
    presentationFrameIndex,
    viewportRef,
  ]);
}
