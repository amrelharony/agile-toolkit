"use client";

/**
 * Per-tab canvas store — local UI state that doesn't belong in the
 * workspace store (camera, tool selection, marquee, etc.). Persisted to
 * `agile-toolkit:canvas` via Zustand persist so a reload restores the
 * user's tool, zoom level, active board, and selection.
 *
 * Authoritative object data lives in the workspace store; this is the
 * UI state on top of it.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Camera, Rect, Vec2 } from "@/lib/geometry/bbox";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import type { AlignmentGuide } from "@/lib/whiteboard/snap";

export type CanvasTool =
  | "select"
  | "hand"
  | "sticky"
  | "rect"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "line"
  | "arrow"
  | "text"
  | "freehand"
  | "connector"
  | "frame"
  | "comment";

/** 8 resize handles + 1 rotation handle (rotation comes in a later PR). */
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Ephemeral drag-state — never persisted. Lives only while pointer is down. */
export interface DragState {
  /** Pointer-down position in WORLD coords. */
  startWorld: Vec2;
  /** Snapshot of every dragged object's initial bbox, keyed by id. */
  initialRects: Record<string, Rect>;
}

export interface ResizeState {
  handle: ResizeHandle;
  startWorld: Vec2;
  /** Initial rect of the single resizing object (multi-resize comes later). */
  initialRect: Rect;
  objectId: string;
}

export interface MarqueeState {
  startWorld: Vec2;
  currentWorld: Vec2;
  /** Selection at marquee-start — restored on Escape. */
  initialSelection: string[];
  /** When true, the new marquee picks add to (not replace) initialSelection. */
  additive: boolean;
}

interface CanvasUiState {
  activeBoardId: string | null;
  camera: Camera;
  tool: CanvasTool;
  selection: string[];
  showGrid: boolean;
  showMiniMap: boolean;
  showAIPanel: boolean;
  /** Sticky color picked from the palette — applied to newly created stickies. */
  stickyColor: string;
  /** Ephemeral interaction state — none of this is persisted. */
  drag: DragState | null;
  resize: ResizeState | null;
  marquee: MarqueeState | null;
  /** In-progress drawing (line/arrow/freehand/frame drag-to-draw). The
   * canvas renders this same object via ObjectRenderer so the preview
   * looks identical to the committed result. Committed on pointerup
   * into the workspace store. */
  drawing: WhiteboardObject | null;
  /** First click of a connector — set when the user clicks the source.
   * Second click on a target object commits the connector. */
  pendingConnectorFromId: string | null;
  /** Alignment guides to render during drag — refreshed on every move. */
  dragGuides: AlignmentGuide[];
  /** Snap-to-grid toggle. Hold Cmd/Ctrl during drag to temporarily flip. */
  snapToGrid: boolean;
  /** Snap-to-object alignment guides toggle. */
  snapToObjects: boolean;

  setActiveBoard: (id: string | null) => void;
  setCamera: (c: Camera) => void;
  setTool: (t: CanvasTool) => void;
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive?: boolean) => void;
  clearSelection: () => void;
  setStickyColor: (color: string) => void;
  setShowGrid: (v: boolean) => void;
  setShowMiniMap: (v: boolean) => void;
  setShowAIPanel: (v: boolean) => void;
  // Interaction state mutators
  setDrag: (d: DragState | null) => void;
  setResize: (r: ResizeState | null) => void;
  setMarquee: (m: MarqueeState | null) => void;
  setDrawing: (o: WhiteboardObject | null) => void;
  setPendingConnectorFromId: (id: string | null) => void;
  setDragGuides: (g: AlignmentGuide[]) => void;
  setSnapToGrid: (v: boolean) => void;
  setSnapToObjects: (v: boolean) => void;
}

export const useCanvasStore = create<CanvasUiState>()(
  persist(
    (set, get) => ({
      activeBoardId: null,
      camera: { x: 0, y: 0, zoom: 1 },
      tool: "select",
      selection: [],
      showGrid: true,
      showMiniMap: true,
      showAIPanel: false,
      stickyColor: "#fde68a",
      drag: null,
      resize: null,
      marquee: null,
      drawing: null,
      pendingConnectorFromId: null,
      dragGuides: [],
      snapToGrid: false,
      snapToObjects: true,

      setActiveBoard: (id) => set({ activeBoardId: id, selection: [] }),
      setCamera: (c) => set({ camera: c }),
      setTool: (t) => set({ tool: t }),
      setSelection: (ids) => set({ selection: ids }),
      toggleSelection: (id, additive) => {
        const cur = get().selection;
        if (!additive) {
          set({ selection: cur.includes(id) && cur.length === 1 ? [] : [id] });
          return;
        }
        if (cur.includes(id)) set({ selection: cur.filter((x) => x !== id) });
        else set({ selection: [...cur, id] });
      },
      clearSelection: () => set({ selection: [] }),
      setStickyColor: (c) => set({ stickyColor: c }),
      setShowGrid: (v) => set({ showGrid: v }),
      setShowMiniMap: (v) => set({ showMiniMap: v }),
      setShowAIPanel: (v) => set({ showAIPanel: v }),
      setDrag: (d) => set({ drag: d }),
      setResize: (r) => set({ resize: r }),
      setMarquee: (m) => set({ marquee: m }),
      setDrawing: (o) => set({ drawing: o }),
      setPendingConnectorFromId: (id) => set({ pendingConnectorFromId: id }),
      setDragGuides: (g) => set({ dragGuides: g }),
      setSnapToGrid: (v) => set({ snapToGrid: v }),
      setSnapToObjects: (v) => set({ snapToObjects: v }),
    }),
    {
      name: "agile-toolkit:canvas",
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") return localStorage;
        return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
      }),
      // Selection is per-session; don't persist it.
      partialize: (s) => ({
        activeBoardId: s.activeBoardId,
        camera: s.camera,
        tool: s.tool,
        showGrid: s.showGrid,
        showMiniMap: s.showMiniMap,
        showAIPanel: s.showAIPanel,
        stickyColor: s.stickyColor,
        snapToGrid: s.snapToGrid,
        snapToObjects: s.snapToObjects,
      }),
    },
  ),
);
