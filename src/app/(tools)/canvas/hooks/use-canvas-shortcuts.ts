"use client";

import { useEffect, type RefObject, type MutableRefObject } from "react";
import { defaultCanvasShortcuts, makeShortcutHandler } from "@/lib/whiteboard/keyboard";
import { copyObjects, duplicateObjects, readClipboardObjects, wbId } from "@/lib/whiteboard/clipboard";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import type { CanvasTool } from "../use-canvas-store";

type LogFn = ReturnType<typeof useHistoryLogger>["log"];

type MarqueeStateLike = { initialSelection: string[] } | null;

/**
 * The big keyboard-shortcut handler.
 *
 * Wired through `defaultCanvasShortcuts` + `makeShortcutHandler` so
 * shortcut definitions stay declarative. Each callback is wrapped in
 * `guardMut` for read-only / commenter modes — mutating shortcuts
 * become no-ops, but navigation/inspect shortcuts (selectAll, copy,
 * cancel) stay live so viewers can still interact.
 *
 * Live object reads come through `objectsRef` / `objectsByIdRef` /
 * `topZRef` rather than closure values: `objects` identity changes on
 * every drag frame (objectsById is memoised on objects), so making
 * those a dep would re-mount the keydown listener at ~60 Hz during
 * any drag.
 *
 * `undo` / `redo` self-suppress while any gesture is in flight:
 * applying an undo snapshot mid-gesture would leave
 * drag.initialRects pointing at object ids that may no longer exist
 * or have mismatched sizes, corrupting the rest of the drag. The
 * user can cancel (Esc) and then press undo again.
 *
 * `cancel` (Esc) walks the gesture chain in priority order:
 * drawing → pendingConnector → drag → resize → rotation → marquee →
 * clear-selection. The marquee branch additionally cancels any
 * in-flight lasso rAF and restores the selection that existed before
 * the marquee began.
 */
export function useCanvasShortcuts(params: {
  // Refs into live state (read at call time, not bind time)
  objectsRef: RefObject<readonly WhiteboardObject[]>;
  objectsByIdRef: RefObject<ReadonlyMap<string, WhiteboardObject>>;
  topZRef: RefObject<number>;
  lassoRafRef: MutableRefObject<number | null>;
  lassoPointsRef: MutableRefObject<number[] | null>;
  lastLassoWorldRef: MutableRefObject<{ x: number; y: number } | null>;
  // Ephemeral interaction state (closure values — drive when the
  // handler should suppress / cancel itself)
  drag: unknown;
  resize: unknown;
  rotation: unknown;
  marquee: MarqueeStateLike;
  drawing: unknown;
  pendingConnectorFromId: string | null;
  // Selection state + setters
  selection: readonly string[];
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  // Ephemeral state setters
  setDrag: (d: null) => void;
  setResize: (r: null) => void;
  setRotation: (r: null) => void;
  setMarquee: (m: null) => void;
  setDrawing: (d: null) => void;
  setPendingConnectorFromId: (id: string | null) => void;
  // Tool selector
  setTool: (t: CanvasTool) => void;
  // Workspace operations
  boardId: string;
  removeMany: (ids: string[]) => void;
  upsertMany: (objs: WhiteboardObject[]) => void;
  // Undo/redo
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  // Logging
  log: LogFn;
  logActivity: (kind: string, summary: string) => void;
  // Mode
  readOnly: boolean;
}) {
  const {
    objectsRef, objectsByIdRef, topZRef,
    lassoRafRef, lassoPointsRef, lastLassoWorldRef,
    drag, resize, rotation, marquee, drawing, pendingConnectorFromId,
    selection, setSelection, clearSelection,
    setDrag, setResize, setRotation, setMarquee, setDrawing, setPendingConnectorFromId,
    setTool,
    boardId, removeMany, upsertMany,
    pushSnapshot, undo, redo,
    log, logActivity,
    readOnly,
  } = params;

  useEffect(() => {
    const bringForward = (step: number) => {
      const liveObjects = objectsRef.current ?? [];
      const sel = liveObjects.filter((o) => selection.includes(o.id));
      if (sel.length === 0) return;
      pushSnapshot();
      // Find actual top + bottom z across the board. The previous version
      // used `objects[0]?.z` for the bottom — that's the FIRST object in
      // insertion order, not the lowest-z one. After a few z-shuffles
      // it returns the wrong baseline and send-backward sometimes raises
      // instead of lowers.
      let topZ = -Infinity;
      let bottomZ = Infinity;
      for (const o of liveObjects) {
        if (o.z > topZ) topZ = o.z;
        if (o.z < bottomZ) bottomZ = o.z;
      }
      if (!Number.isFinite(topZ)) topZ = 0;
      if (!Number.isFinite(bottomZ)) bottomZ = 0;
      const updates = sel.map((o, i) => ({
        ...o,
        z: step > 0
          ? topZ + i + 1
          // Allow z to go negative — easier to reason about than clamping
          // at 0 (clamping caused stacking-order collisions when multiple
          // objects already sat at z=0).
          : bottomZ - sel.length + i,
        updatedAt: new Date().toISOString(),
      }));
      upsertMany(updates);
    };
    const toggleLock = () => {
      const liveObjects = objectsRef.current ?? [];
      const sel = liveObjects.filter((o) => selection.includes(o.id));
      if (sel.length === 0) return;
      pushSnapshot();
      const allLocked = sel.every((o) => o.locked);
      const updates = sel.map((o) => ({ ...o, locked: !allLocked, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };
    const groupSelection = () => {
      const liveObjects = objectsRef.current ?? [];
      const sel = liveObjects.filter((o) => selection.includes(o.id));
      if (sel.length < 2) return;
      pushSnapshot();
      const gid = wbId("wbg");
      const updates = sel.map((o) => ({ ...o, groupId: gid, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };
    const ungroupSelection = () => {
      const liveObjects = objectsRef.current ?? [];
      const sel = liveObjects.filter((o) => selection.includes(o.id) && o.groupId);
      if (sel.length === 0) return;
      pushSnapshot();
      const updates = sel.map((o) => ({ ...o, groupId: undefined, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };

    // ReadOnly-gated wrapper: any callback wrapped here is a no-op in
    // viewer/commenter mode. Defense-in-depth — even if a key reaches
    // the handler, the mutation is silenced. Non-mutating shortcuts
    // (selectAll, copy, cancel) stay live so viewers can still
    // navigate and inspect.
    const guardMut = <Args extends unknown[]>(fn: (...args: Args) => void) =>
      (...args: Args) => { if (!readOnly) fn(...args); };
    const handler = makeShortcutHandler(
      defaultCanvasShortcuts({
        setTool: (t) => setTool(t as CanvasTool),
        deleteSelected: guardMut(() => {
          if (selection.length === 0) return;
          pushSnapshot();
          // Capture types BEFORE the remove for a sane activity summary.
          const summary = selection.length === 1
            ? `Deleted ${objectsByIdRef.current?.get(selection[0])?.type ?? "object"}`
            : `Deleted ${selection.length} objects`;
          removeMany([...selection]);
          log(CANVAS_ACTIONS.OBJECT_REMOVED, { count: selection.length, ids: selection });
          logActivity("deleted", summary);
          clearSelection();
        }),
        selectAll: () => setSelection((objectsRef.current ?? []).map((o) => o.id)),
        copy: () => {
          const sel = (objectsRef.current ?? []).filter((o) => selection.includes(o.id));
          if (sel.length > 0) void copyObjects(sel);
        },
        cut: guardMut(() => {
          const sel = (objectsRef.current ?? []).filter((o) => selection.includes(o.id));
          if (sel.length === 0) return;
          pushSnapshot();
          void copyObjects(sel);
          removeMany([...selection]);
          log(CANVAS_ACTIONS.OBJECT_REMOVED, { count: selection.length, ids: selection, action: "cut" });
          logActivity(
            "cut",
            sel.length === 1 ? `Cut ${sel[0].type}` : `Cut ${sel.length} objects`,
          );
          clearSelection();
        }),
        paste: guardMut(() => {
          void (async () => {
            const pasted = await readClipboardObjects(boardId);
            if (pasted.length === 0) return;
            pushSnapshot();
            // O(1) read via cached topZRef instead of scanning the
            // entire object list.
            const topZ = topZRef.current ?? 0;
            const repositioned = pasted.map((p, i) => ({ ...p, z: topZ + i + 1 }));
            upsertMany(repositioned);
            log(CANVAS_ACTIONS.OBJECTS_PASTED, { count: repositioned.length });
            setSelection(repositioned.map((p) => p.id));
          })();
        }),
        duplicate: guardMut(() => {
          const sel = (objectsRef.current ?? []).filter((o) => selection.includes(o.id));
          if (sel.length === 0) return;
          pushSnapshot();
          const dup = duplicateObjects(sel, boardId);
          const topZ = topZRef.current ?? 0;
          const repositioned = dup.map((p, i) => ({ ...p, z: topZ + i + 1 }));
          upsertMany(repositioned);
          log(CANVAS_ACTIONS.OBJECTS_PASTED, { count: repositioned.length, action: "duplicate" });
          setSelection(repositioned.map((p) => p.id));
        }),
        bringForward: guardMut(() => bringForward(1)),
        sendBackward: guardMut(() => bringForward(-1)),
        toggleLock: guardMut(toggleLock),
        groupSelection: guardMut(groupSelection),
        ungroupSelection: guardMut(ungroupSelection),
        // Guard undo/redo against mid-interaction triggers AND against
        // readOnly mode (undo can't restore a state the local user
        // can't write back). If a drag / resize / marquee / drawing is
        // in flight, the canvas store has ephemeral state pointing at
        // the *current* object state, and applying an undo snapshot
        // would leave drag.initialRects referring to ids that may no
        // longer exist or have mismatched sizes — the rest of the
        // gesture would corrupt the board. Cancel the in-flight
        // interaction first; user can hit undo a second time to
        // actually step back.
        undo: guardMut(() => {
          if (drag || resize || rotation || marquee || drawing) return;
          undo();
        }),
        redo: guardMut(() => {
          if (drag || resize || rotation || marquee || drawing) return;
          redo();
        }),
        cancel: () => {
          // Single Esc: end whatever interaction is in progress; if none,
          // clear selection. Keeps the gesture chain predictable.
          if (drawing) { setDrawing(null); return; }
          if (pendingConnectorFromId) { setPendingConnectorFromId(null); return; }
          if (drag) { setDrag(null); return; }
          if (resize) { setResize(null); return; }
          if (rotation) { setRotation(null); return; }
          if (marquee) {
            if (lassoRafRef.current != null) {
              cancelAnimationFrame(lassoRafRef.current);
              lassoRafRef.current = null;
            }
            lassoPointsRef.current = null;
            lastLassoWorldRef.current = null;
            setSelection([...marquee.initialSelection]);
            setMarquee(null);
            return;
          }
          if (selection.length > 0) clearSelection();
        },
      }),
    );
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // Refs (objectsRef, objectsByIdRef, topZRef, lassoRafRef,
    // lassoPointsRef, lastLassoWorldRef) are deliberately omitted —
    // they are stable identities and reading them at call time is the
    // whole point. Adding them to the dep array would change nothing
    // behaviourally but would clutter the warning surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    setTool, selection, removeMany, upsertMany, clearSelection, setSelection,
    boardId, drag, resize, rotation, marquee, drawing, pendingConnectorFromId,
    setDrag, setResize, setRotation, setMarquee, setDrawing, setPendingConnectorFromId,
    log, logActivity, pushSnapshot, undo, redo, readOnly,
  ]);
}
