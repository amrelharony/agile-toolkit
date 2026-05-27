"use client";

import { useEffect, useRef, useState } from "react";
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
  // BUG-RD3-toolbar-top-1: hold a controlled draft so a cross-tab /
  // realtime rename landing while the user is mid-edit doesn't silently
  // desync the input's displayed text from board.name. We seed the
  // draft from board.name only on the rising edge of `editing` (entry
  // into rename mode) and never overwrite it mid-edit.
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // R5: inline two-step confirm replaces the blocking `confirm()` call
  // (which froze the JS thread, stalling any in-flight realtime
  // broadcast for the duration of the modal). When `confirmingDelete`
  // is true, the Delete button label changes to "Click again to delete"
  // and a 3s timeout auto-cancels the arming.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // R11-fix: hold the disarm timer in a ref so unmount can cancel it.
  // The previous `window.setTimeout(...)` kept firing after the
  // component unmounted, invoking setConfirmingDelete on a dead
  // instance — React 18 swallows the warning, but the captured
  // setState closure leaks.
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current !== null) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    };
  }, []);
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
    // R11-fix: reject empty / whitespace-only names. The previous
    // implementation accepted "" and the board picker rendered a
    // blank <option> the user couldn't visually identify or recover.
    // Fall back to "Untitled board" if the input trims to empty.
    const trimmed = name.trim();
    const safeName = trimmed.length > 0 ? trimmed : "Untitled board";
    if (safeName === board.name) return; // no-op rename
    upsertBoard({ ...board, name: safeName, updatedAt: new Date().toISOString() });
    log(CANVAS_ACTIONS.BOARD_RENAMED, { boardId: board.id });
  }

  function deleteCurrent() {
    if (!board) return;
    // R5: arm-then-confirm flow (instead of blocking `confirm()`). First
    // click sets `confirmingDelete=true` and starts a 3s timer to
    // auto-cancel; second click within that window actually deletes.
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        confirmTimerRef.current = null;
        setConfirmingDelete(false);
      }, 3000);
      return;
    }
    setConfirmingDelete(false);
    if (confirmTimerRef.current !== null) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
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
      // Restructured into three visual groups separated by hairline
      // dividers:
      //   [board picker + rename/delete] | [+ New board] | [view toggles]
      // Previously each item was separated by inline `w-px` dividers and
      // the New-board action sat dangerously close to the trash button.
      // Now the destructive Delete is contained inside the first group
      // and "+ New" gets its own breathing room before the view toggles.
      //
      // Responsive constraints (narrow viewports):
      //   - `max-w-[calc(100%-1rem)]` so the toolbar never extends past
      //     the canvas viewport edges, with overflow-x-auto for the
      //     rare case the user has 20+ boards and the picker label is
      //     long
      //   - `flex-wrap` would split groups across rows which looks
      //     worse than a horizontal scroll — keep it nowrap
      className="absolute top-2 sm:top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-surface/95 border border-border rounded-lg px-2 py-1 shadow-lg backdrop-blur-sm z-10 max-w-[calc(100%-1rem)] flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      // PNG export filters out anything carrying this attribute.
      data-canvas-export-ignore="true"
    >
      {/* Group 1 — board picker, rename, delete */}
      <div className="flex items-center gap-1.5 px-1 shrink-0">
        <select
          aria-label="Active board"
          value={board?.id ?? ""}
          onChange={(e) => setActiveBoard(e.target.value)}
          // max-w shrinks on narrow viewports so the picker doesn't push
          // the rest of the toolbar off-screen. 120px fits ~14 chars
          // which covers most reasonable board names.
          className="bg-transparent text-sm text-text font-mono outline-none cursor-pointer max-w-[120px] sm:max-w-[160px]"
        >
          {boards.length === 0 && <option value="">No boards yet</option>}
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {board && (
          <>
            {editing ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  rename(nameDraft);
                  setEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    rename(nameDraft);
                    setEditing(false);
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                className="bg-surface-deep border border-border rounded px-2 py-0.5 text-sm text-text"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNameDraft(board.name);
                  setEditing(true);
                }}
                className="text-[11px] text-sub hover:text-accent transition-colors uppercase tracking-wider"
                title="Rename board"
                aria-label={`Rename board ${board.name}`}
              >
                edit
              </button>
            )}
            <button
              type="button"
              onClick={deleteCurrent}
              aria-label={
                confirmingDelete ? "Click again to confirm delete" : "Delete current board"
              }
              className={cn(
                "min-touch-coarse transition-colors w-7 h-7 rounded flex items-center justify-center",
                confirmingDelete
                  ? "text-red-400 hover:text-red-300 bg-red-500/10"
                  : "text-sub hover:text-red-400 hover:bg-text/[0.04]"
              )}
              title={confirmingDelete ? "Click again to confirm" : `Delete "${board?.name ?? ""}"`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            {confirmingDelete && (
              <span role="status" className="sr-only">
                Click delete again to confirm. Will auto-cancel in 3 seconds.
              </span>
            )}
          </>
        )}
      </div>

      {/* Group 2 — create */}
      <div className="w-px h-5 bg-border shrink-0" aria-hidden="true" />
      <button
        type="button"
        onClick={createBoard}
        className="text-xs text-accent hover:text-accent/80 transition-colors inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/5 shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
        New
      </button>

      {/* Group 3 — view toggles (snap, minimap, present, AI) */}
      <div className="w-px h-5 bg-border shrink-0" aria-hidden="true" />
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => setSnapToGridEnabled(!snapToGridEnabled)}
          aria-pressed={snapToGridEnabled}
          title="Snap to grid (Cmd/Ctrl toggles during drag)"
          className={cn(
            "min-touch-coarse w-7 h-7 rounded flex items-center justify-center transition-colors",
            snapToGridEnabled
              ? "bg-accent/20 text-accent"
              : "text-sub hover:text-text hover:bg-text/[0.04]"
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
            "min-touch-coarse w-7 h-7 rounded flex items-center justify-center transition-colors",
            snapToObjects
              ? "bg-accent/20 text-accent"
              : "text-sub hover:text-text hover:bg-text/[0.04]"
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
            "min-touch-coarse w-7 h-7 rounded flex items-center justify-center transition-colors",
            showMiniMap
              ? "bg-accent/20 text-accent"
              : "text-sub hover:text-text hover:bg-text/[0.04]"
          )}
        >
          <Map className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setPresentationFrameIndex(0)}
          aria-label="Enter presentation mode"
          title="Present (frame-by-frame)"
          className="w-7 h-7 rounded flex items-center justify-center transition-colors text-sub hover:text-text hover:bg-text/[0.04]"
        >
          <PlayCircle className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowAIPanel(!showAIPanel)}
          aria-pressed={showAIPanel}
          title="Toggle AI insights panel"
          className={cn(
            "min-touch-coarse w-7 h-7 rounded flex items-center justify-center transition-colors",
            showAIPanel
              ? "bg-accent/20 text-accent"
              : "text-sub hover:text-text hover:bg-text/[0.04]"
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
