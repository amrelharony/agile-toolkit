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

export function useCanvasUndoStack(activeBoardId: string | null) {
  const undoStack = useRef<WhiteboardObject[][]>([]);
  const redoStack = useRef<WhiteboardObject[][]>([]);
  // We snapshot the *previous* state when a mutation is about to be
  // applied externally. `pushSnapshot()` is called from edit pointer-up,
  // delete, paste, etc.

  // Reset stacks when switching boards — undo from another board is
  // meaningless on this one.
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
  }, [activeBoardId]);

  const pushSnapshot = useCallback(() => {
    if (!activeBoardId) return;
    const all = useWorkspaceStore.getState().whiteboardObjects ?? [];
    const slice = all.filter((o) => o.boardId === activeBoardId).map((o) => ({ ...o }));
    undoStack.current.push(slice);
    if (undoStack.current.length > STACK_LIMIT) undoStack.current.shift();
    // Any new edit invalidates the redo stack.
    redoStack.current = [];
  }, [activeBoardId]);

  const undo = useCallback(() => {
    if (!activeBoardId || undoStack.current.length === 0) return;
    const previous = undoStack.current.pop()!;
    // Stash current state for redo BEFORE applying the previous.
    const cur = (useWorkspaceStore.getState().whiteboardObjects ?? [])
      .filter((o) => o.boardId === activeBoardId)
      .map((o) => ({ ...o }));
    redoStack.current.push(cur);
    applyBoardSlice(activeBoardId, previous);
  }, [activeBoardId]);

  const redo = useCallback(() => {
    if (!activeBoardId || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    const cur = (useWorkspaceStore.getState().whiteboardObjects ?? [])
      .filter((o) => o.boardId === activeBoardId)
      .map((o) => ({ ...o }));
    undoStack.current.push(cur);
    applyBoardSlice(activeBoardId, next);
  }, [activeBoardId]);

  const canUndo = useCallback(() => undoStack.current.length > 0, []);
  const canRedo = useCallback(() => redoStack.current.length > 0, []);

  return { pushSnapshot, undo, redo, canUndo, canRedo };
}

/**
 * Replace the active board's slice of whiteboardObjects with the given
 * snapshot. Other boards' objects stay untouched.
 */
function applyBoardSlice(boardId: string, slice: WhiteboardObject[]) {
  const store = useWorkspaceStore.getState();
  const all = store.whiteboardObjects ?? [];
  const otherBoards = all.filter((o) => o.boardId !== boardId);
  const snapshotIds = new Set(slice.map((o) => o.id));
  // Remove any objects on this board that aren't in the snapshot.
  const currentBoardIds = all.filter((o) => o.boardId === boardId).map((o) => o.id);
  const toRemove = currentBoardIds.filter((id) => !snapshotIds.has(id));
  if (toRemove.length > 0) store.removeWhiteboardObjects(toRemove);
  // Upsert the snapshot (version-bumped to win LWW against any stale
  // realtime patch that fires after the undo).
  const bumped = slice.map((o) => ({ ...o, version: o.version + 1, updatedAt: new Date().toISOString() }));
  if (bumped.length > 0) store.upsertWhiteboardObjects(bumped);
  // otherBoards reference is held just to silence the unused lint; the
  // store's filter-by-id semantics already preserve them.
  void otherBoards;
}
