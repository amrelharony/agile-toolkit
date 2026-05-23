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
  | "comment"
  // Phase 25+ tools:
  | "card"
  | "timer"
  | "voting"
  | "kanban"
  | "table";

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
  /** Initial rect of the primary resizing object — kept for backwards
   * compatibility with single-object resize math. For multi-object
   * resize, see {@link initialRects} / {@link initialUnion}. */
  initialRect: Rect;
  objectId: string;
  /** All initial rects keyed by id — set for multi-object resize so we
   * can scale every object proportionally to the union bbox change.
   * Single-object resize leaves this with just one entry. */
  initialRects?: Record<string, Rect>;
  /** Union bbox of the initial rects — the scale anchor for multi-
   * object resize. Single-object resize uses `initialRect`. */
  initialUnion?: Rect;
}

/** In-flight rotation. Each object's rotation field is updated by the
 * delta angle from the pointer's angle relative to the union centre. */
export interface RotationState {
  /** World coords of the rotation anchor (union centre of selection). */
  centerWorld: Vec2;
  /** Angle in degrees from centre → initial pointer position. The
   * pointer-move handler subtracts this from the current pointer angle
   * to produce the rotation delta. */
  startAngleDeg: number;
  /** Initial rotation per object, keyed by id. */
  initialRotations: Record<string, number>;
}

export interface MarqueeState {
  startWorld: Vec2;
  currentWorld: Vec2;
  /** Selection at marquee-start — restored on Escape. */
  initialSelection: string[];
  /** When true, the new marquee picks add to (not replace) initialSelection. */
  additive: boolean;
  /** When set, marquee is in LASSO mode — a freeform polygon instead of
   * a rectangle. Stored as a flat [x0,y0,x1,y1,…] array in WORLD coords.
   * Used as the click selection set on pointer-up via point-in-polygon
   * hit-testing. */
  lassoPoints?: number[];
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
  rotation: RotationState | null;
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
  /** Currently-editing object id (sticky / text / shape with content).
   * Exactly one object can be in inline-edit mode at a time across the
   * whole canvas. Ephemeral — never persisted. */
  editingObjectId: string | null;
  /** When set, the local camera tracks this peer's viewport on every
   * presence update. Cleared by any local pan / zoom interaction (so
   * "follow" feels like a soft beacon — you can break out by moving). */
  followUserId: string | null;
  /** Phase 29 — per-board frame bookmarks. Each entry is a frame
   * object id. Toggled via Cmd+Shift+B; the toolbar surfaces them as
   * a quick-jump menu. Persisted so favourites survive reload. */
  frameBookmarks: Record<string, string[]>; // boardId -> frame ids
  /** Presentation mode — when non-null, the canvas renders in
   * full-bleed mode and arrow keys cycle through frames. */
  presentationFrameIndex: number | null;
  /** Active tag filter — when non-empty, the canvas dims objects whose
   * `tags` field doesn't intersect this set. Ephemeral; never persisted
   * (a filter that survives reload would be a UX trap). Phase 26. */
  tagFilter: string[];

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
  setRotation: (r: RotationState | null) => void;
  setMarquee: (m: MarqueeState | null) => void;
  setDrawing: (o: WhiteboardObject | null) => void;
  setPendingConnectorFromId: (id: string | null) => void;
  setDragGuides: (g: AlignmentGuide[]) => void;
  setSnapToGrid: (v: boolean) => void;
  setSnapToObjects: (v: boolean) => void;
  setEditingObjectId: (id: string | null) => void;
  setFollowUserId: (id: string | null) => void;
  toggleFrameBookmark: (boardId: string, frameId: string) => void;
  setPresentationFrameIndex: (i: number | null) => void;
  setTagFilter: (tags: string[]) => void;
  toggleTagFilter: (tag: string) => void;
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
      rotation: null,
      marquee: null,
      drawing: null,
      pendingConnectorFromId: null,
      dragGuides: [],
      snapToGrid: false,
      snapToObjects: true,
      editingObjectId: null,
      followUserId: null,
      frameBookmarks: {},
      presentationFrameIndex: null,
      tagFilter: [],

      setActiveBoard: (id) => set({ activeBoardId: id, selection: [] }),
      setCamera: (c) => set({ camera: c }),
      setTool: (t) => set({ tool: t }),
      setSelection: (ids) => set({ selection: ids }),
      toggleSelection: (id, additive) => set((state) => {
        const cur = state.selection;
        if (!additive) {
          return { selection: cur.includes(id) && cur.length === 1 ? [] : [id] };
        }
        if (cur.includes(id)) return { selection: cur.filter((x) => x !== id) };
        return { selection: [...cur, id] };
      }),
      clearSelection: () => set({ selection: [] }),
      setStickyColor: (c) => set({ stickyColor: c }),
      setShowGrid: (v) => set({ showGrid: v }),
      setShowMiniMap: (v) => set({ showMiniMap: v }),
      setShowAIPanel: (v) => set({ showAIPanel: v }),
      setDrag: (d) => set({ drag: d }),
      setResize: (r) => set({ resize: r }),
      setRotation: (r) => set({ rotation: r }),
      setMarquee: (m) => set({ marquee: m }),
      setDrawing: (o) => set({ drawing: o }),
      setPendingConnectorFromId: (id) => set({ pendingConnectorFromId: id }),
      setDragGuides: (g) => set({ dragGuides: g }),
      setSnapToGrid: (v) => set({ snapToGrid: v }),
      setSnapToObjects: (v) => set({ snapToObjects: v }),
      setEditingObjectId: (id) => set({ editingObjectId: id }),
      setFollowUserId: (id) => set({ followUserId: id }),
      toggleFrameBookmark: (boardId, frameId) => {
        const cur = get().frameBookmarks ?? {};
        const list = cur[boardId] ?? [];
        const next = list.includes(frameId)
          ? list.filter((x) => x !== frameId)
          : [...list, frameId];
        set({ frameBookmarks: { ...cur, [boardId]: next } });
      },
      setPresentationFrameIndex: (i) => set({ presentationFrameIndex: i }),
      setTagFilter: (tags) => set({ tagFilter: tags }),
      toggleTagFilter: (tag) => set((state) => ({
        tagFilter: (state.tagFilter ?? []).includes(tag)
          ? (state.tagFilter ?? []).filter((t) => t !== tag)
          : [...(state.tagFilter ?? []), tag],
      })),
    }),
    {
      name: "agile-toolkit:canvas",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        // Match the workspace store's quota / SecurityError handling.
        // Safari Private Browsing throws on every localStorage access;
        // a full origin throws QuotaExceededError on setItem. Without
        // wrapping, either would crash the canvas mount during
        // hydration. The persisted state here is tiny (camera, tool,
        // bookmarks) so the only realistic failure mode is the
        // origin-wide quota being already saturated by the workspace
        // store / images.
        return {
          getItem: (k: string) => {
            try {
              return localStorage.getItem(k);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                "[canvas-store] localStorage.getItem blocked — starting with default UI state.",
                err,
              );
              return null;
            }
          },
          setItem: (k: string, v: string) => {
            try {
              localStorage.setItem(k, v);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn(
                "[canvas-store] localStorage write failed — UI state held in memory only.",
                err,
              );
            }
          },
          removeItem: (k: string) => {
            try {
              localStorage.removeItem(k);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn("[canvas-store] localStorage.removeItem blocked.", err);
            }
          },
        };
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
        frameBookmarks: s.frameBookmarks,
      }),
    },
  ),
);
