"use client";

import { useState } from "react";
import { Plus, Trash2, Sparkles, Map, Magnet, Grid3X3, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { emitSignal } from "@/lib/signals/signal-bus";
import { wbId } from "@/lib/whiteboard/clipboard";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { useCanvasStore } from "../use-canvas-store";

export function ToolbarTop() {
  const boards = useWorkspaceStore((s) => s.whiteboards ?? []);
  const activeBoardId = useCanvasStore((s) => s.activeBoardId);
  const setActiveBoard = useCanvasStore((s) => s.setActiveBoard);
  const upsertBoard = useWorkspaceStore((s) => s.upsertWhiteboard);
  const removeBoard = useWorkspaceStore((s) => s.removeWhiteboard);
  const showAIPanel = useCanvasStore((s) => s.showAIPanel);
  const setShowAIPanel = useCanvasStore((s) => s.setShowAIPanel);
  const setPresentationFrameIndex = useCanvasStore((s) => s.setPresentationFrameIndex);
  const showMiniMap = useCanvasStore((s) => s.showMiniMap);
  const setShowMiniMap = useCanvasStore((s) => s.setShowMiniMap);
  const snapToObjects = useCanvasStore((s) => s.snapToObjects);
  const setSnapToObjects = useCanvasStore((s) => s.setSnapToObjects);
  const snapToGridEnabled = useCanvasStore((s) => s.snapToGrid);
  const setSnapToGridEnabled = useCanvasStore((s) => s.setSnapToGrid);
  const [editing, setEditing] = useState(false);
  // R5: inline two-step confirm replaces the blocking `confirm()` call
  // (which froze the JS thread, stalling any in-flight realtime
  // broadcast for the duration of the modal). When `confirmingDelete`
  // is true, the Delete button label changes to "Click again to delete"
  // and a 3s timeout auto-cancels the arming.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const board = boards.find((b) => b.id === activeBoardId);
  // History logger — board create/delete are MILESTONE_PAIRS in
  // event-actions.ts, but until now the toolbar wasn't actually
  // calling `log()`, so /history filtered to canvas saw nothing.
  const { log } = useHistoryLogger("canvas");

  function createBoard() {
    const now = new Date().toISOString();
    const id = wbId("wb_board");
    upsertBoard({ id, name: `Board ${boards.length + 1}`, createdAt: now, updatedAt: now });
    setActiveBoard(id);
    log(CANVAS_ACTIONS.BOARD_CREATED, { boardId: id, totalBoards: boards.length + 1 });
    // Cross-tool signal — anything subscribed to "whiteboard.boardCreated"
    // (analytics, dashboards) wakes up. Existed in the SignalKind union
    // since Phase 22 but had no emit site, so subscribers never fired.
    emitSignal({
      kind: "whiteboard.boardCreated",
      at: now,
      toolId: "canvas",
      payload: { boardId: id },
    });
  }

  function rename(name: string) {
    if (!board) return;
    upsertBoard({ ...board, name, updatedAt: new Date().toISOString() });
    log(CANVAS_ACTIONS.BOARD_RENAMED, { boardId: board.id });
  }

  function deleteCurrent() {
    if (!board) return;
    // R5: arm-then-confirm flow (instead of blocking `confirm()`). First
    // click sets `confirmingDelete=true` and starts a 3s timer to
    // auto-cancel; second click within that window actually deletes.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    setConfirmingDelete(false);
    const deletedId = board.id;
    removeBoard(deletedId);
    // R5: read the LIVE boards list after removal so we don't pick the
    // board we just deleted (the closure-captured `boards` still
    // contains it). Use getState() to avoid the stale closure.
    const liveBoards = useWorkspaceStore.getState().whiteboards ?? [];
    const next = liveBoards.find((b) => b.id !== deletedId);
    setActiveBoard(next?.id ?? null);
    log(CANVAS_ACTIONS.BOARD_DELETED, { boardId: deletedId });
    emitSignal({
      kind: "whiteboard.boardDeleted",
      at: new Date().toISOString(),
      toolId: "canvas",
      payload: { boardId: deletedId },
    });
  }

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-surface/95 border border-border rounded-lg px-3 py-1.5 shadow-lg backdrop-blur-sm z-10"
      // PNG export filters out anything carrying this attribute.
      data-canvas-export-ignore="true"
    >
      <select
        aria-label="Active board"
        value={board?.id ?? ""}
        onChange={(e) => setActiveBoard(e.target.value)}
        className="bg-transparent text-sm text-text font-mono outline-none cursor-pointer"
      >
        {boards.length === 0 && <option value="">No boards yet</option>}
        {boards.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      {board && (
        <>
          {editing ? (
            <input
              autoFocus
              defaultValue={board.name}
              onBlur={(e) => { rename(e.target.value); setEditing(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { rename((e.target as HTMLInputElement).value); setEditing(false); }
                if (e.key === "Escape") setEditing(false);
              }}
              className="bg-surface-deep border border-border rounded px-2 py-0.5 text-sm text-text"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-sub hover:text-accent transition-colors"
              title="Rename board"
              aria-label={`Rename board ${board.name}`}
            >
              edit
            </button>
          )}
          <button
            type="button"
            onClick={deleteCurrent}
            aria-label={confirmingDelete ? "Click again to confirm delete" : "Delete current board"}
            className={cn(
              "transition-colors",
              confirmingDelete ? "text-red-400 hover:text-red-300" : "text-sub hover:text-red-400",
            )}
            title={confirmingDelete ? "Click again to confirm" : `Delete "${board?.name ?? ""}"`}
          >
            <Trash2 className={cn("w-4 h-4", confirmingDelete && "animate-pulse")} />
          </button>
        </>
      )}
      <div className="w-px h-4 bg-border" />
      <button
        type="button"
        onClick={createBoard}
        className="text-xs text-accent hover:text-accent/80 transition-colors inline-flex items-center gap-1"
      >
        <Plus className="w-3.5 h-3.5" />
        New board
      </button>
      <div className="w-px h-4 bg-border" />
      {/* Toggle row — snap-to-grid, snap-to-objects, minimap, AI panel. */}
      <button
        type="button"
        onClick={() => setSnapToGridEnabled(!snapToGridEnabled)}
        aria-pressed={snapToGridEnabled}
        title="Snap to grid (Cmd/Ctrl toggles during drag)"
        className={cn(
          "w-7 h-7 rounded flex items-center justify-center transition-colors",
          snapToGridEnabled ? "bg-accent/20 text-accent" : "text-sub hover:text-text",
        )}
      >
        <Grid3X3 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setSnapToObjects(!snapToObjects)}
        aria-pressed={snapToObjects}
        title="Snap to objects (alignment guides)"
        className={cn(
          "w-7 h-7 rounded flex items-center justify-center transition-colors",
          snapToObjects ? "bg-accent/20 text-accent" : "text-sub hover:text-text",
        )}
      >
        <Magnet className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setShowMiniMap(!showMiniMap)}
        aria-pressed={showMiniMap}
        title="Toggle minimap"
        className={cn(
          "w-7 h-7 rounded flex items-center justify-center transition-colors",
          showMiniMap ? "bg-accent/20 text-accent" : "text-sub hover:text-text",
        )}
      >
        <Map className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setPresentationFrameIndex(0)}
        aria-label="Enter presentation mode"
        title="Present (frame-by-frame)"
        className={cn(
          "w-7 h-7 rounded flex items-center justify-center transition-colors",
          "text-sub hover:text-text",
        )}
      >
        <PlayCircle className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setShowAIPanel(!showAIPanel)}
        aria-pressed={showAIPanel}
        title="Toggle AI insights panel"
        className={cn(
          "w-7 h-7 rounded flex items-center justify-center transition-colors",
          showAIPanel ? "bg-accent/20 text-accent" : "text-sub hover:text-text",
        )}
      >
        <Sparkles className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
