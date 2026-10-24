"use client";

/**
 * Snapshot-based undo/redo for the canvas's whiteboard-objects slice.
 *
 * The workspace store doesn't go through `withTimeTravel` (it's shared
 * across 100+ tools and wrapping it would force every tool into the
 * snapshot protocol). Instead, the canvas snapshots its own per-board
 * objects array at edit boundaries (pointer-up after a drag/draw,
 * delete, paste, etc.) and pushes onto a ring-buffer kept in this hook.
 *
 * Limitations:
 *  - 50 snapshots per board; oldest discarded
 *  - Undo restores all objects on the active board, not just the touched
 *    ones — simpler and matches Miro's "step back" semantics
 *  - Doesn't snapshot the camera or selection
 *
 * Why not `withTimeTravel`? It registers a per-tool middleware and binds
 * to a single Zustand store. The workspace store is shared; per-tool
 * snapshots of *just whiteboardObjects* are cheaper and don't risk
 * undoing unrelated tool state.
 */

import { useCallback, useEffect, useRef } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

const STACK_LIMIT = 50;

/**
 * A change outside the board's objects that an edit on the canvas made,
 * for Cmd+Z to take back with it and Cmd+Shift+Z to make again: a live
 * Sprint board card's move or rename writes its story
 * (lib/live-card-writer), which a snapshot of the objects can't restore
 * (the board lays the card out from the story again straight after). Each
 * must leave alone what has changed since, as the writer's do.
 */
export interface CanvasUndoEffect {
  undo: () => void;
  redo: () => void;
}

/** One undo step: the board's objects as they were, a change elsewhere, or both. */
interface UndoEntry {
  slice: WhiteboardObject[] | null;
  effect?: CanvasUndoEffect;
}

/**
 * The open canvas's `pushSnapshot` for each board, so UI outside the
 * canvas (the template gallery) can record its own undo step.
 */
const openBoards = new Map<string, () => void>();

/**
 * Record an undo step on `boardId`'s canvas, if it is open, before
 * changing the board's objects from outside it. Without one, Cmd+Z right
 * after would restore the snapshot from before the previous edit: the
 * change and that earlier edit would both go.
 */
export function pushBoardSnapshot(boardId: string): void {
  openBoards.get(boardId)?.();
}

/**
 * Deep-clone a list of whiteboard objects.
 *
 * The previous shallow `({ ...o })` only copied the top-level fields and
 * shared every nested array/object (tags, votes, points, sourceRef,
 * columns, options, etc.) with the workspace store. If anything in the
 * codebase ever mutated those nested structures in-place (e.g. an
 * accidental `o.tags.push(...)` from a future tool), the mutation would
 * retroactively rewrite undo history. structuredClone is fast enough for
 * our snapshot rate (~1 Hz max — one push per drag/resize/paste/delete);
 * the JSON fallback keeps older runtimes happy without poisoning the
 * stack with shared references.
 */
function deepCloneSlice(slice: WhiteboardObject[]): WhiteboardObject[] {
  return typeof structuredClone === "function"
    ? structuredClone(slice)
    : (JSON.parse(JSON.stringify(slice)) as WhiteboardObject[]);
}

/**
 * Cheap equality heuristic for two whiteboard-object snapshots: compare
 * length + total version sum. Catches the common "user pressed Cmd+S
 * twice / pushSnapshot ran on a no-op gesture" case without paying the
 * cost of a full JSON.stringify comparison on 500-object boards. Two
 * snapshots can theoretically collide on length + version-sum without
 * being identical (one object's +1 version offsetting another's -1),
 * but in practice version numbers only ever increase — so a collision
 * is the snapshot we'd want to drop anyway.
 */
function snapshotsEqual(a: WhiteboardObject[], b: WhiteboardObject[]): boolean {
  if (a.length !== b.length) return false;
  let aSum = 0;
  let bSum = 0;
  for (const o of a) aSum += o.version;
  for (const o of b) bSum += o.version;
  return aSum === bSum;
}

/** A deep copy of `boardId`'s objects as they are now. */
const currentSlice = (boardId: string) =>
  deepCloneSlice(
    (useWorkspaceStore.getState().whiteboardObjects ?? []).filter((o) => o.boardId === boardId)
  );

export function useCanvasUndoStack(activeBoardId: string | null) {
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  // We snapshot the *previous* state when a mutation is about to be
  // applied externally. `pushSnapshot()` is called from edit pointer-up,
  // delete, paste, etc.

  // Reset stacks when switching boards — undo from another board is
  // meaningless on this one.
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
  }, [activeBoardId]);

  const push = useCallback((entry: UndoEntry) => {
    undoStack.current.push(entry);
    if (undoStack.current.length > STACK_LIMIT) undoStack.current.shift();
    // Any new edit invalidates the redo stack.
    redoStack.current = [];
  }, []);

  /** Snapshot the board before an edit; `effect` is what the edit changes elsewhere. */
  const pushSnapshot = useCallback(
    (effect?: CanvasUndoEffect) => {
      if (!activeBoardId) return;
      const slice = currentSlice(activeBoardId);
      // Skip when this snapshot matches the top of the undo stack — no-op
      // pushes (e.g. an align that returns early, a paste of zero items
      // wrapped by a snapshot, undo→redo cycles) would otherwise bloat
      // the stack and force users to mash Cmd+Z through empty entries
      // before reaching a real edit. Never when either step changes
      // something elsewhere: that's a step of its own.
      const top = undoStack.current[undoStack.current.length - 1];
      if (!effect && top?.slice && !top.effect && snapshotsEqual(slice, top.slice)) return;
      push({ slice, effect });
    },
    [activeBoardId, push]
  );

  /**
   * Record an edit that changed nothing on the board for good, only
   * `effect`'s data: a live card's move, which the board then lays out.
   */
  const pushUndoEffect = useCallback(
    (effect: CanvasUndoEffect) => {
      if (activeBoardId) push({ slice: null, effect });
    },
    [activeBoardId, push]
  );

  useEffect(() => {
    if (!activeBoardId) return;
    const record = () => pushSnapshot();
    openBoards.set(activeBoardId, record);
    return () => {
      if (openBoards.get(activeBoardId) === record) openBoards.delete(activeBoardId);
    };
  }, [activeBoardId, pushSnapshot]);

  const undo = useCallback(() => {
    if (!activeBoardId || undoStack.current.length === 0) return;
    const previous = undoStack.current.pop()!;
    // Stash current state for redo BEFORE applying the previous.
    redoStack.current.push({
      slice: previous.slice && currentSlice(activeBoardId),
      effect: previous.effect,
    });
    if (previous.slice) applyBoardSlice(activeBoardId, previous.slice);
    previous.effect?.undo();
  }, [activeBoardId]);

  const redo = useCallback(() => {
    if (!activeBoardId || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push({
      slice: next.slice && currentSlice(activeBoardId),
      effect: next.effect,
    });
    if (next.slice) applyBoardSlice(activeBoardId, next.slice);
    next.effect?.redo();
  }, [activeBoardId]);

  const canUndo = useCallback(() => undoStack.current.length > 0, []);
  const canRedo = useCallback(() => redoStack.current.length > 0, []);

  return { pushSnapshot, pushUndoEffect, undo, redo, canUndo, canRedo };
}

/**
 * Replace the active board's slice of whiteboardObjects with the given
 * snapshot. Other boards' objects stay untouched.
 *
 * BUG-T1-canvas-5: use the atomic `replaceBoardWhiteboardObjects`
 * action so the restore is ONE setState (one subscriber wave, one
 * realtime broadcast) instead of the prior remove-then-upsert pair
 * that flickered on peers and split the React render into two passes.
 */
function applyBoardSlice(boardId: string, slice: WhiteboardObject[]) {
  const store = useWorkspaceStore.getState();
  const all = store.whiteboardObjects ?? [];
  // Deep-clone the snapshot before applying. The stack might hand us
  // the exact same array reference more than once
  // (push→undo→redo→undo), so storing raw stack objects would let any
  // subsequent edit on the workspace store retroactively mutate the
  // cached snapshot.
  const cloned =
    typeof structuredClone === "function"
      ? structuredClone(slice)
      : (JSON.parse(JSON.stringify(slice)) as WhiteboardObject[]);
  // Version-bump anchored to live-max so concurrent peer broadcasts
  // can't override the restore under LWW.
  const currentOnBoard = all.filter((o) => o.boardId === boardId);
  const currentById = new Map<string, WhiteboardObject>();
  for (const o of currentOnBoard) currentById.set(o.id, o);
  const now = new Date().toISOString();
  const bumped = cloned.map((o) => {
    const live = currentById.get(o.id);
    const liveVersion = live?.version ?? 0;
    const baseVersion = Math.max(o.version, liveVersion);
    return { ...o, version: baseVersion + 1, updatedAt: now };
  });
  store.replaceBoardWhiteboardObjects(boardId, bumped);
}
