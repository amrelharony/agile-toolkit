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
    const filtered = all.filter((o) => o.boardId === activeBoardId);
    const slice = deepCloneSlice(filtered);
    // Skip when this snapshot matches the top of the undo stack — no-op
    // pushes (e.g. an align that returns early, a paste of zero items
    // wrapped by a snapshot, undo→redo cycles) would otherwise bloat
    // the stack and force users to mash Cmd+Z through empty entries
    // before reaching a real edit.
    const top = undoStack.current[undoStack.current.length - 1];
    if (top && snapshotsEqual(slice, top)) return;
    undoStack.current.push(slice);
    if (undoStack.current.length > STACK_LIMIT) undoStack.current.shift();
    // Any new edit invalidates the redo stack.
    redoStack.current = [];
  }, [activeBoardId]);

  const undo = useCallback(() => {
    if (!activeBoardId || undoStack.current.length === 0) return;
    const previous = undoStack.current.pop()!;
    // Stash current state for redo BEFORE applying the previous.
    const cur = deepCloneSlice(
      (useWorkspaceStore.getState().whiteboardObjects ?? []).filter(
        (o) => o.boardId === activeBoardId
      )
    );
    redoStack.current.push(cur);
    applyBoardSlice(activeBoardId, previous);
  }, [activeBoardId]);

  const redo = useCallback(() => {
    if (!activeBoardId || redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    const cur = deepCloneSlice(
      (useWorkspaceStore.getState().whiteboardObjects ?? []).filter(
        (o) => o.boardId === activeBoardId
      )
    );
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
