"use client";

import { useEffect, useMemo, useState } from "react";
import { useLegacyMigrationMode } from "@/lib/data/use-legacy-migration-mode";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { syncEngine } from "@/lib/sync/engine";
import { useCanvasStore } from "../use-canvas-store";
import { isLiveContainer, reconcileLiveBoards, type LivePlan } from "../lib/live-boards";

/** How long the board waits after a change before catching up (coalesces bursts). */
export const LIVE_RECONCILE_MS = 150;

/**
 * Write a reconcile plan: one bulk upsert and one bulk remove, so a sprint
 * of fifty stories is one store change and one realtime broadcast, not
 * fifty. Never through the canvas's Cmd+Z snapshots: these writes follow
 * the workspace, they aren't the user's edits to undo.
 */
export function applyLivePlan(plan: LivePlan): void {
  const ws = useWorkspaceStore.getState();
  if (plan.upsert.length > 0) ws.upsertWhiteboardObjects(plan.upsert);
  // Before the remove, which deletes the threads pinned to what it removes:
  // a kept card's threads move to its plain copy.
  if (plan.rehome && plan.rehome.length > 0) {
    const to = new Map(plan.rehome.map((r) => [r.from, r.to]));
    for (const t of useWorkspaceStore.getState().whiteboardCommentThreads ?? []) {
      const next = t.objectId ? to.get(t.objectId) : undefined;
      if (next) ws.upsertWhiteboardCommentThread({ ...t, objectId: next });
    }
  }
  if (plan.remove.length > 0) ws.removeWhiteboardObjects(plan.remove);
}

/** True while a pointer gesture or an inline edit is in progress on the canvas. */
function gestureInProgress(s: ReturnType<typeof useCanvasStore.getState>): boolean {
  return (
    s.drag !== null ||
    s.resize !== null ||
    s.rotation !== null ||
    s.marquee !== null ||
    s.drawing !== null ||
    s.editingObjectId !== null
  );
}

/**
 * Keep the open board's live boards (Sprint board, Story map) in step with
 * the stories, sprints and story map, and catch up whenever the board opens.
 *
 * It only writes once this device's workspace can be trusted: loaded here,
 * and for the owner after the cloud's first pull, so a fresh device never
 * empties a Sprint board against a story list that hasn't arrived yet
 * (`useLegacyMigrationMode` is the app's rule for that). It waits out any
 * drag, resize or inline edit, and runs again when it ends: moving a card
 * mid-drag would fight the pointer. Read-only and commenter views never
 * write, and visitor boards on a share link mount only the bare canvas.
 */
export function useLiveBoards({
  boardId,
  objects,
  readOnly,
}: {
  boardId: string | null;
  /** The open board's objects. */
  objects: readonly WhiteboardObject[];
  readOnly: boolean;
}): void {
  const hasLive = useMemo(() => objects.some(isLiveContainer), [objects]);
  const mode = useLegacyMigrationMode(hasLive);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mode === "local") {
      setReady(true);
      return;
    }
    if (mode !== "cloud") {
      setReady(false);
      return;
    }
    let cancelled = false;
    void syncEngine.whenReady().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const busy = useCanvasStore(gestureInProgress);
  const stories = useWorkspaceStore((s) => s.stories);
  const sprints = useWorkspaceStore((s) => s.sprints);
  const storyMaps = useWorkspaceStore((s) => s.storyMaps);

  useEffect(() => {
    if (!boardId || !ready || readOnly || busy || !hasLive) return;
    const t = setTimeout(() => {
      // A gesture may have started since the change that scheduled this.
      if (gestureInProgress(useCanvasStore.getState())) return;
      const ws = useWorkspaceStore.getState();
      const plan = reconcileLiveBoards(
        (ws.whiteboardObjects ?? []).filter((o) => o.boardId === boardId),
        {
          stories: ws.stories,
          sprints: ws.sprints,
          storyMaps: ws.storyMaps ?? [],
          threads: (ws.whiteboardCommentThreads ?? []).filter((t) => t.boardId === boardId),
        },
        new Date().toISOString()
      );
      applyLivePlan(plan);
    }, LIVE_RECONCILE_MS);
    return () => clearTimeout(t);
  }, [boardId, ready, readOnly, busy, hasLive, objects, stories, sprints, storyMaps]);
}
