"use client";

import { useState } from "react";
import { Plus, Trash2, Sparkles, Map, Magnet, Grid3X3, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { emitSignal } from "@/lib/signals/signal-bus";
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
  const board = boards.find((b) => b.id === activeBoardId);

  function createBoard() {
    const now = new Date().toISOString();
    const id = `wb_board_${Math.random().toString(36).slice(2, 11)}`;
    upsertBoard({ id, name: `Board ${boards.length + 1}`, createdAt: now, updatedAt: now });
    setActiveBoard(id);
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
  }

  function deleteCurrent() {
    if (!board) return;
    if (!confirm(`Delete board "${board.name}"? This removes all objects on it.`)) return;
    const deletedId = board.id;
    removeBoard(deletedId);
    const next = boards.find((b) => b.id !== deletedId);
    setActiveBoard(next?.id ?? null);
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
            aria-label="Delete current board"
            className="text-sub hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
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
