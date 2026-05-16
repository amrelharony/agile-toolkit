"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { panBy, zoomAt, fitToRects } from "@/lib/whiteboard/canvas-transform";
import { rafThrottle } from "@/lib/utils/throttle";
import { aabbIntersect, boundingBoxOfFlatPoints, rectFromCorners, rectUnion, rectOverlapsPolygon } from "@/lib/geometry/bbox";
import type { Rect } from "@/lib/geometry/bbox";
import { copyObjects, duplicateObjects, readClipboardObjects } from "@/lib/whiteboard/clipboard";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { defaultCanvasShortcuts, makeShortcutHandler } from "@/lib/whiteboard/keyboard";
import { snapToGrid as snapToGridFn, snapToObjects as snapToObjectsFn, DEFAULT_GRID_SIZE, DEFAULT_GUIDE_TOLERANCE } from "@/lib/whiteboard/snap";
import { useCanvasUndoStack } from "../use-undo-stack";
import { useCanvasStore, type ResizeHandle } from "../use-canvas-store";
import { ObjectRenderer } from "./object-renderer";
import { Marquee } from "./marquee";
import { SelectionHandles } from "./selection-handles";
import { AlignToolbar } from "./align-toolbar";
import { PropertyPanel } from "./property-panel";
import { PresentationMode } from "./presentation-mode";
import { align as alignFn, distribute as distributeFn, type AlignOp, type DistributeOp } from "@/lib/whiteboard/align";
import { extractImageFiles, fileToImage, imageToObject } from "@/lib/whiteboard/image-import";
import { ChatComposer } from "./chat-composer";
import { ConnectorLayer } from "./connector-layer";
import { AlignmentGuides } from "./alignment-guides";
import { ClusterOverlay } from "./cluster-overlay";
import { MiniMap } from "./mini-map";
import { CommentPins } from "./comment-pins";
import { CommentDrawer } from "./comment-drawer";
import { AIInsightsPanel } from "./ai-insights-panel";
import { clusterObjects } from "@/lib/whiteboard/cluster-bridge";
import { boardInsights } from "@/lib/analytics/board-insights";
import { useCanvasRoom } from "@/lib/whiteboard/use-canvas-room";
import { useCanvasPresence } from "@/lib/whiteboard/use-canvas-presence";
import { CursorOverlay } from "./cursor-overlay";

interface WhiteboardCanvasProps {
  boardId: string;
  onViewportSize?: (s: { w: number; h: number }) => void;
  /** When true, viewer mode: render only, no mutations. Pan + zoom
   * still work. Phase 32. */
  readOnly?: boolean;
}

const STICKY_DEFAULT = { w: 200, h: 160 };
const SHAPE_DEFAULT = { w: 160, h: 120 };
const TEXT_DEFAULT = { w: 240, h: 40 };

// Returns a fresh z that is strictly greater than every current object's z
// so newly-created objects always land on top of existing ones. Computed
// per-call from the live object list — the previous module-level counter
// reset to 1 on every page reload, sandwiching new objects UNDER existing
// ones with z > 2.
function nextZAbove(existing: readonly WhiteboardObject[]): number {
  if (existing.length === 0) return 1;
  let max = 0;
  for (const o of existing) if (o.z > max) max = o.z;
  return max + 1;
}

/**
 * The whiteboard viewport.
 *
 * Implements:
 *   - pan via middle-mouse-drag OR space-hold-left-drag OR hand tool
 *   - zoom via wheel (zoom-to-cursor)
 *   - click-to-add for sticky / shape / text tools
 *   - selection on left-click of an object (additive with shift)
 *   - empty-canvas hint when no objects exist
 *
 * Drag-to-move, marquee select, resize, free-hand, connectors come in
 * later PRs (22B–22G). This PR is "static render + add + select + pan/zoom".
 */
export function WhiteboardCanvas({ boardId, onViewportSize, readOnly = false }: WhiteboardCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // Select the stable array reference, then filter inside useMemo. Inline
  // .filter() in the Zustand selector returns a NEW array on every store
  // snapshot (including unrelated mutations from other tools), defeating
  // Zustand's Object.is equality and causing the viewport to re-render on
  // every workspace change.
  const allObjects = useWorkspaceStore((s) => s.whiteboardObjects);
  const objects = useMemo(
    () => (allObjects ?? []).filter((o) => o.boardId === boardId),
    [allObjects, boardId],
  );
  const upsert = useWorkspaceStore((s) => s.upsertWhiteboardObject);
  const upsertMany = useWorkspaceStore((s) => s.upsertWhiteboardObjects);
  const removeMany = useWorkspaceStore((s) => s.removeWhiteboardObjects);
  const upsertCommentThread = useWorkspaceStore((s) => s.upsertWhiteboardCommentThread);
  const appendActivity = useWorkspaceStore((s) => s.appendWhiteboardActivity);
  const allCommentThreads = useWorkspaceStore((s) => s.whiteboardCommentThreads);
  const commentThreads = useMemo(
    () => (allCommentThreads ?? []).filter((c) => c.boardId === boardId),
    [allCommentThreads, boardId],
  );
  const camera = useCanvasStore((s) => s.camera);
  const setCamera = useCanvasStore((s) => s.setCamera);
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  const selection = useCanvasStore((s) => s.selection);
  const setSelection = useCanvasStore((s) => s.setSelection);
  const toggleSelection = useCanvasStore((s) => s.toggleSelection);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const stickyColor = useCanvasStore((s) => s.stickyColor);
  const showGrid = useCanvasStore((s) => s.showGrid);
  const drag = useCanvasStore((s) => s.drag);
  const setDrag = useCanvasStore((s) => s.setDrag);
  const resize = useCanvasStore((s) => s.resize);
  const setResize = useCanvasStore((s) => s.setResize);
  const rotation = useCanvasStore((s) => s.rotation);
  const setRotation = useCanvasStore((s) => s.setRotation);
  const marquee = useCanvasStore((s) => s.marquee);
  const setMarquee = useCanvasStore((s) => s.setMarquee);
  const drawing = useCanvasStore((s) => s.drawing);
  const setDrawing = useCanvasStore((s) => s.setDrawing);
  const pendingConnectorFromId = useCanvasStore((s) => s.pendingConnectorFromId);
  const setPendingConnectorFromId = useCanvasStore((s) => s.setPendingConnectorFromId);
  const dragGuides = useCanvasStore((s) => s.dragGuides);
  const setDragGuides = useCanvasStore((s) => s.setDragGuides);
  const snapToGridEnabled = useCanvasStore((s) => s.snapToGrid);
  const snapToObjectsEnabled = useCanvasStore((s) => s.snapToObjects);
  const showAIPanel = useCanvasStore((s) => s.showAIPanel);
  const setShowAIPanel = useCanvasStore((s) => s.setShowAIPanel);
  const showMiniMap = useCanvasStore((s) => s.showMiniMap);
  const editingObjectId = useCanvasStore((s) => s.editingObjectId);
  const setEditingObjectId = useCanvasStore((s) => s.setEditingObjectId);
  const followUserId = useCanvasStore((s) => s.followUserId);
  const setFollowUserId = useCanvasStore((s) => s.setFollowUserId);
  const presentationFrameIndex = useCanvasStore((s) => s.presentationFrameIndex);
  const setPresentationFrameIndex = useCanvasStore((s) => s.setPresentationFrameIndex);
  const [activeCommentThreadId, setActiveCommentThreadId] = useState<string | null>(null);
  // Cursor-chat composer state. When non-null, a small textbox appears
  // at the last known cursor position; Enter publishes a chatBubble on
  // presence, Esc cancels. Triggered by pressing "/" on an empty canvas.
  // The DRAFT lives inside the ChatComposer child component (not here)
  // so per-keystroke setState doesn't re-render the entire viewport.
  const [chatComposerScreen, setChatComposerScreen] = useState<{ x: number; y: number } | null>(null);
  const { log } = useHistoryLogger("canvas");
  const { pushSnapshot, undo, redo } = useCanvasUndoStack(boardId);

  // Ephemeral interaction state (drag / resize / marquee / drawing /
  // pendingConnectorFromId / dragGuides) is keyed implicitly by boardId.
  // When the user switches boards, any in-flight gesture from the previous
  // board would leak into the new one — a half-finished drawing would
  // commit to the wrong boardId on pointerup, a pending connector source
  // id would reference an object that isn't visible, etc. Reset all on
  // board change AND on component unmount.
  useEffect(() => {
    return () => {
      setDrag(null);
      setResize(null);
      setRotation(null);
      setMarquee(null);
      setDrawing(null);
      setPendingConnectorFromId(null);
      setDragGuides([]);
      setEditingObjectId(null);
    };
  }, [boardId, setDrag, setResize, setRotation, setMarquee, setDrawing, setPendingConnectorFromId, setDragGuides, setEditingObjectId]);

  // Tool-switch cleanup: ending the gesture-in-progress when the user
  // presses a tool shortcut (e.g. 'N' for sticky) while a marquee or
  // pending-connector first-click is active. Without this, the marquee
  // continues rendering after the user picks a different tool, and the
  // next pointer-down can fork into both "marquee-update" and "new
  // sticky" code paths. We deliberately do NOT clear `drag` / `resize` /
  // `drawing` here — those have an active pointer capture, and their
  // pointer-up handler is the right place to finalise them.
  // Also exits text edit mode — switching tools means the user has moved
  // on from the textarea.
  useEffect(() => {
    setMarquee(null);
    setPendingConnectorFromId(null);
    setEditingObjectId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // ─── Multiplayer: realtime diff-sync + presence (cursors / selection)
  // Mounting both hooks is a no-op when Supabase env vars aren't set
  // (use-room flips to local-only mode), so solo users pay zero cost.
  useCanvasRoom({ toolId: "canvas", roomId: boardId, boardId });
  const channelName = boardId ? `tool:canvas:presence:${boardId}` : null;
  const { members, publish, self } = useCanvasPresence(channelName);

  // Activity-log helper. Coalesces small per-keystroke events into
  // larger summaries by skipping no-op summaries and only logging
  // when the caller passes a non-empty `summary`.
  const logActivity = useCallback(
    (kind: string, summary: string) => {
      if (!summary || summary.length === 0) return;
      appendActivity({
        id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        boardId,
        at: Date.now(),
        author: self.name || "Anonymous",
        kind,
        summary,
      });
    },
    [appendActivity, boardId, self.name],
  );

  // Publish selection + tool changes to peers. Cursor updates happen
  // inside onCanvasPointerMove so they ride along with the local move.
  useEffect(() => {
    publish({ selection, tool });
  }, [selection, tool, publish]);
  // World position of the cursor, refreshed on every pointermove. Used by
  // the connector preview line. Kept as a ref to avoid a re-render storm
  // — only the connector-layer component (and only when the preview
  // exists) needs the per-frame position, so we update state at 60 fps
  // via rAF and read it through a memoized preview prop.
  const [previewCursor, setPreviewCursor] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const spaceHeldRef = useRef(false);
  // Object lookup map for O(1) hit-test during drag.
  const objectsById = useMemo(() => {
    const m = new Map<string, WhiteboardObject>();
    for (const o of objects) m.set(o.id, o);
    return m;
  }, [objects]);
  // Cluster + insights — only computed while the AI panel is open so we
  // don't pay the k-means cost on every render. Memoised on objects so
  // movement re-runs clustering live.
  const clusters = useMemo(
    () => (showAIPanel ? clusterObjects(objects) : []),
    [objects, showAIPanel],
  );
  const insights = useMemo(
    () => (showAIPanel ? boardInsights(objects) : []),
    [objects, showAIPanel],
  );
  const activeCommentThread = useMemo(
    () => commentThreads.find((t) => t.id === activeCommentThreadId) ?? null,
    [commentThreads, activeCommentThreadId],
  );
  // Selection bounding box — used by the resize handles.
  const selectionBbox = useMemo<Rect | null>(() => {
    const selected = selection
      .map((id) => objectsById.get(id))
      .filter((o): o is WhiteboardObject => !!o);
    if (selected.length === 0) return null;
    let bbox: Rect = { x: selected[0].x, y: selected[0].y, w: selected[0].w, h: selected[0].h };
    for (let i = 1; i < selected.length; i++) {
      const o = selected[i];
      bbox = rectUnion(bbox, { x: o.x, y: o.y, w: o.w, h: o.h });
    }
    return bbox;
  }, [selection, objectsById]);

  // Frames sorted by their position (top-to-bottom, left-to-right) so
  // presentation order is predictable on a complex board. Memoised
  // so the order stays stable across non-frame changes.
  const orderedFrames = useMemo(() => {
    return objects
      .filter((o): o is WhiteboardObject & { type: "frame" } => o.type === "frame")
      .slice()
      .sort((a, b) => {
        // Primary: row buckets at 100 px. Secondary: x.
        const ra = Math.floor(a.y / 100);
        const rb = Math.floor(b.y / 100);
        if (ra !== rb) return ra - rb;
        return a.x - b.x;
      });
  }, [objects]);

  // Whenever presentationFrameIndex changes, fit the camera to that frame.
  useEffect(() => {
    if (presentationFrameIndex === null) return;
    if (size.w === 0) return;
    const frame = orderedFrames[presentationFrameIndex];
    if (!frame) return;
    const cam = fitToRects([{ x: frame.x, y: frame.y, w: frame.w, h: frame.h }], size.w, size.h, 0.15);
    if (cam) setCamera(cam);
  }, [presentationFrameIndex, orderedFrames, size.w, size.h, setCamera]);

  // Arrow-key navigation while presenting (and Esc to exit). Window-
  // level so focus doesn't matter.
  useEffect(() => {
    if (presentationFrameIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setPresentationFrameIndex(Math.min(orderedFrames.length - 1, presentationFrameIndex + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPresentationFrameIndex(Math.max(0, presentationFrameIndex - 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPresentationFrameIndex(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentationFrameIndex, orderedFrames.length, setPresentationFrameIndex]);

  // Follow-user: when `followUserId` is set, keep the local camera
  // synced to that peer's viewport. The presence layer broadcasts
  // viewport on every change, so this effect re-runs and snaps our
  // camera. A locally-initiated pan/zoom (via onCanvasPointer*) does
  // NOT clear the follow latch — that's done via `setFollowUserId(null)`
  // when the user clicks the follow button again.
  useEffect(() => {
    if (!followUserId) return;
    const peer = members.find((m) => m.id === followUserId);
    if (!peer || !peer.viewport) return;
    setCamera({ x: peer.viewport.x, y: peer.viewport.y, zoom: peer.viewport.zoom });
  }, [followUserId, members, setCamera]);

  // Track viewport size for fit-to-content + minimap calculations.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const next = { w: r.width, h: r.height };
      setSize(next);
      onViewportSize?.(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onViewportSize]);

  // Cancel in-flight interactions when the tab is hidden. Without this,
  // a user who Cmd-Tabs away mid-drag returns to find the canvas stuck
  // in "drag" mode forever (the pointer-up never fires on a backgrounded
  // tab). Visibility-change is a reliable signal for "I'm about to lose
  // pointer events" — cancel cleanly so the next focus is fresh.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (!document.hidden) return;
      // Only cancel STATE; don't touch the workspace store. The user's
      // partial edits stay where they are (the drag handler already
      // mutated positions as the pointer moved). We just clear the
      // ephemeral state machine.
      if (drag) setDrag(null);
      if (resize) setResize(null);
      if (rotation) setRotation(null);
      if (marquee) setMarquee(null);
      if (drawing) setDrawing(null);
      if (dragGuides.length > 0) setDragGuides([]);
      spaceHeldRef.current = false;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [drag, resize, rotation, marquee, drawing, dragGuides.length, setDrag, setResize, setRotation, setMarquee, setDrawing, setDragGuides]);

  // Space-hold = temporary pan mode.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " && !spaceHeldRef.current) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        spaceHeldRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeldRef.current = false;
    };
    // Reset on window blur — if the user Cmd-Tabs away while holding space,
    // the keyup event fires on the other app, leaving spaceHeldRef true
    // forever. Next time they click in our viewport it pans instead of
    // dragging. The blur handler defensively resets the latch.
    const onBlur = () => { spaceHeldRef.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // rAF-throttled setCamera so wheel + pan don't thrash React.
  const throttledSetCamera = useRef(rafThrottle(setCamera)).current;

  // ─── Keyboard shortcuts ──────────────────────────────────────────────
  // Wired here (rather than in canvas-client) so they see the live
  // selection from useCanvasStore and operate on the active board's
  // objects. The shortcut handler ignores keys typed inside input/
  // textarea/contenteditable elements so editing a sticky's text stays
  // unaffected. Esc cancels marquee + drag + resize even if focus is
  // outside the canvas.
  useEffect(() => {
    // Helpers used by multiple shortcuts.
    const bringForward = (step: number) => {
      const sel = objects.filter((o) => selection.includes(o.id));
      if (sel.length === 0) return;
      pushSnapshot();
      // Find actual top + bottom z across the board. The previous version
      // used `objects[0]?.z` for the bottom — that's the FIRST object in
      // insertion order, not the lowest-z one. After a few z-shuffles
      // it returns the wrong baseline and send-backward sometimes raises
      // instead of lowers.
      let topZ = -Infinity;
      let bottomZ = Infinity;
      for (const o of objects) {
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
      const sel = objects.filter((o) => selection.includes(o.id));
      if (sel.length === 0) return;
      pushSnapshot();
      const allLocked = sel.every((o) => o.locked);
      const updates = sel.map((o) => ({ ...o, locked: !allLocked, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };
    const groupSelection = () => {
      const sel = objects.filter((o) => selection.includes(o.id));
      if (sel.length < 2) return;
      pushSnapshot();
      const gid = `wbg_${Math.random().toString(36).slice(2, 11)}`;
      const updates = sel.map((o) => ({ ...o, groupId: gid, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };
    const ungroupSelection = () => {
      const sel = objects.filter((o) => selection.includes(o.id) && o.groupId);
      if (sel.length === 0) return;
      pushSnapshot();
      const updates = sel.map((o) => ({ ...o, groupId: undefined, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };

    const handler = makeShortcutHandler(
      defaultCanvasShortcuts({
        setTool: (t) => setTool(t as Parameters<typeof setTool>[0]),
        deleteSelected: () => {
          if (selection.length === 0) return;
          pushSnapshot();
          removeMany(selection);
          log(CANVAS_ACTIONS.OBJECT_REMOVED, { count: selection.length, ids: selection });
          clearSelection();
        },
        selectAll: () => setSelection(objects.map((o) => o.id)),
        copy: () => {
          const sel = objects.filter((o) => selection.includes(o.id));
          if (sel.length > 0) void copyObjects(sel);
        },
        cut: () => {
          const sel = objects.filter((o) => selection.includes(o.id));
          if (sel.length === 0) return;
          pushSnapshot();
          void copyObjects(sel);
          removeMany(selection);
          log(CANVAS_ACTIONS.OBJECT_REMOVED, { count: selection.length, ids: selection, action: "cut" });
          clearSelection();
        },
        paste: () => {
          void (async () => {
            const pasted = await readClipboardObjects(boardId);
            if (pasted.length === 0) return;
            pushSnapshot();
            let topZ = 0;
            for (const o of objects) if (o.z > topZ) topZ = o.z;
            const repositioned = pasted.map((p, i) => ({ ...p, z: topZ + i + 1 }));
            upsertMany(repositioned);
            log(CANVAS_ACTIONS.OBJECTS_PASTED, { count: repositioned.length });
            setSelection(repositioned.map((p) => p.id));
          })();
        },
        duplicate: () => {
          const sel = objects.filter((o) => selection.includes(o.id));
          if (sel.length === 0) return;
          pushSnapshot();
          const dup = duplicateObjects(sel, boardId);
          let topZ = 0;
          for (const o of objects) if (o.z > topZ) topZ = o.z;
          const repositioned = dup.map((p, i) => ({ ...p, z: topZ + i + 1 }));
          upsertMany(repositioned);
          log(CANVAS_ACTIONS.OBJECTS_PASTED, { count: repositioned.length, action: "duplicate" });
          setSelection(repositioned.map((p) => p.id));
        },
        bringForward: () => bringForward(1),
        sendBackward: () => bringForward(-1),
        toggleLock,
        groupSelection,
        ungroupSelection,
        // Guard undo/redo against mid-interaction triggers. If a drag /
        // resize / marquee / drawing is in flight, the canvas store has
        // ephemeral state pointing at the *current* object state, and
        // applying an undo snapshot would leave drag.initialRects
        // referring to ids that may no longer exist or have mismatched
        // sizes — the rest of the gesture would corrupt the board.
        // Cancel the in-flight interaction first; user can hit undo a
        // second time to actually step back.
        undo: () => {
          if (drag || resize || rotation || marquee || drawing) return;
          undo();
        },
        redo: () => {
          if (drag || resize || rotation || marquee || drawing) return;
          redo();
        },
        cancel: () => {
          // Single Esc: end whatever interaction is in progress; if none,
          // clear selection. Keeps the gesture chain predictable.
          if (drawing) { setDrawing(null); return; }
          if (pendingConnectorFromId) { setPendingConnectorFromId(null); return; }
          if (drag) { setDrag(null); return; }
          if (resize) { setResize(null); return; }
          if (rotation) { setRotation(null); return; }
          if (marquee) {
            setSelection(marquee.initialSelection);
            setMarquee(null);
            return;
          }
          if (selection.length > 0) clearSelection();
        },
        // Undo / redo are not yet wired to the workspace store — they'll
        // land alongside withTimeTravel integration in PR 22D.
      }),
    );
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTool, selection, objects, removeMany, upsertMany, clearSelection, setSelection, boardId, drag, resize, marquee, drawing, pendingConnectorFromId, setDrag, setResize, setMarquee, setDrawing, setPendingConnectorFromId, log, pushSnapshot, undo, redo]);

  // ─── Tab/Shift-Tab to cycle through objects (a11y).
  // Without this, keyboard-only users can't navigate the board at all —
  // every object is mouse-pointer driven. Tab moves selection to the
  // next object in z-order; Shift+Tab moves backwards. After cycling,
  // the camera pans to keep the new selection visible.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (objects.length === 0) return;
      e.preventDefault();
      const ordered = objects.slice().sort((a, b) => a.z - b.z);
      const currentIdx = selection.length === 1
        ? ordered.findIndex((o) => o.id === selection[0])
        : -1;
      let nextIdx: number;
      if (e.shiftKey) {
        nextIdx = currentIdx <= 0 ? ordered.length - 1 : currentIdx - 1;
      } else {
        nextIdx = currentIdx >= ordered.length - 1 ? 0 : currentIdx + 1;
      }
      const next = ordered[nextIdx];
      if (!next) return;
      setSelection([next.id]);
      // Pan to keep the selection visible (10% margin around the
      // object's bbox). Don't override zoom unless we're way off.
      if (size.w > 0) {
        const cam = fitToRects([{ x: next.x, y: next.y, w: next.w, h: next.h }], size.w, size.h, 1.0);
        if (cam) setCamera({ x: cam.x, y: cam.y, zoom: Math.min(cam.zoom, camera.zoom) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [objects, selection, size.w, size.h, camera.zoom, setSelection, setCamera]);

  // ─── Enter key on a selected sticky/text/card → enter edit mode.
  // Mirrors Miro/Figma convention: select an object, press Enter, start
  // typing. Without this, users who selected (but didn't double-click)
  // a sticky and tried to type saw nothing happen — the most common
  // "I can't type in stickies" complaint.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (editingObjectId) return; // already editing
      if (selection.length !== 1) return;
      const obj = objectsById.get(selection[0]);
      if (!obj || obj.locked) return;
      const editable = obj.type === "sticky" || obj.type === "text"
        || obj.type === "card"
        || obj.type === "rect" || obj.type === "ellipse"
        || obj.type === "diamond" || obj.type === "triangle";
      if (!editable) return;
      e.preventDefault();
      setEditingObjectId(obj.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, objectsById, editingObjectId, setEditingObjectId]);

  // ─── Cursor chat (/) + emoji reactions (1-6).
  // The "/" key opens a small composer floating at the current screen
  // cursor; type → Enter publishes a `chatBubble` on presence, Esc cancels.
  // Number keys 1-6 emit emoji reactions at the current world-cursor.
  const EMOJI_KEYS: Record<string, string> = {
    "1": "👍", "2": "❤️", "3": "😂", "4": "🎉", "5": "🤔", "6": "👀",
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // "/" opens cursor chat at the last known screen-pointer location.
      if (e.key === "/" && !chatComposerScreen) {
        const last = lastPointerRef.current;
        if (!last) return;
        e.preventDefault();
        setChatComposerScreen({ x: last.x, y: last.y });
        return;
      }
      // 1-6 spawn an emoji reaction at the cursor world position.
      const emoji = EMOJI_KEYS[e.key];
      if (emoji && lastPointerRef.current) {
        const world = clientToWorld(lastPointerRef.current.x, lastPointerRef.current.y);
        publish({
          reaction: { emoji, x: world.x, y: world.y, expiresAt: Date.now() + 6_000 },
        });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatComposerScreen, publish]);

  // ─── Arrow-key nudge — independent handler since `makeShortcutHandler`
  // doesn't model arrow keys with their direction.
  //
  // OS auto-repeat fires keydown ~30 Hz on typical settings. Without
  // batching we'd dispatch one upsertMany per event, causing 30
  // store mutations / sec — each one triggering the realtime broadcast
  // listener, the workspace-store subscribers, and a full re-render of
  // every selected object. We accumulate the deltas into a single
  // animation-frame and flush once per frame so the move feels smooth
  // but the store sees at most ~60 updates / sec regardless of repeat
  // rate.
  useEffect(() => {
    let pendingDx = 0;
    let pendingDy = 0;
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      if (pendingDx === 0 && pendingDy === 0) return;
      const dx = pendingDx;
      const dy = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      const updates: WhiteboardObject[] = [];
      for (const id of selection) {
        const o = objectsById.get(id);
        if (!o) continue;
        updates.push({ ...o, x: o.x + dx, y: o.y + dy, updatedAt: new Date().toISOString() });
      }
      if (updates.length > 0) upsertMany(updates);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (selection.length === 0) return;
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step;
      else if (e.key === "ArrowDown") dy = step;
      else return;
      e.preventDefault();
      pendingDx += dx;
      pendingDy += dy;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [selection, objectsById, upsertMany]);

  // Zoom-to-cursor on wheel.
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!viewportRef.current) return;
      const rect = viewportRef.current.getBoundingClientRect();
      const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // Trackpad pinch sends ctrlKey+deltaY; mouse wheel sends bare deltaY.
      // Both should zoom (Figma/Miro convention) — we don't distinguish.
      const factor = Math.pow(1.0015, -e.deltaY);
      throttledSetCamera(zoomAt(camera, focal, camera.zoom * factor));
    },
    [camera, throttledSetCamera],
  );

  // Convert client pointer event to world coords.
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left) / camera.zoom + camera.x,
        y: (clientY - rect.top) / camera.zoom + camera.y,
      };
    },
    [camera],
  );

  const addObjectAt = useCallback(
    (worldX: number, worldY: number) => {
      const id = `wb_${Math.random().toString(36).slice(2, 11)}`;
      const now = new Date().toISOString();
      const base = { id, boardId, version: 1, z: nextZAbove(objects), createdAt: now, updatedAt: now };
      let obj: WhiteboardObject | null = null;
      switch (tool) {
        case "sticky":
          obj = {
            ...base, type: "sticky",
            x: worldX - STICKY_DEFAULT.w / 2,
            y: worldY - STICKY_DEFAULT.h / 2,
            w: STICKY_DEFAULT.w, h: STICKY_DEFAULT.h,
            content: "", color: stickyColor,
          };
          break;
        case "rect":
        case "ellipse":
        case "diamond":
        case "triangle":
          obj = {
            ...base, type: tool,
            x: worldX - SHAPE_DEFAULT.w / 2,
            y: worldY - SHAPE_DEFAULT.h / 2,
            w: SHAPE_DEFAULT.w, h: SHAPE_DEFAULT.h,
            stroke: "#94a3b8", strokeWidth: 1.5,
          };
          break;
        case "text":
          obj = {
            ...base, type: "text",
            x: worldX - TEXT_DEFAULT.w / 2,
            y: worldY,
            w: TEXT_DEFAULT.w, h: TEXT_DEFAULT.h,
            content: "Text", fontSize: 18, color: "#e5e7eb", align: "left",
          };
          break;
        case "frame":
          obj = {
            ...base, type: "frame",
            x: worldX - 320, y: worldY - 200,
            w: 640, h: 400,
            label: "Frame",
          };
          break;
        case "card":
          obj = {
            ...base, type: "card",
            x: worldX - 100, y: worldY - 60,
            w: 200, h: 120,
            title: "New card",
            color: "#00f0ff",
          };
          break;
        case "kanban":
          obj = {
            ...base, type: "kanban",
            x: worldX - 360, y: worldY - 200,
            w: 720, h: 400,
            label: "Kanban",
            columns: ["todo", "in_progress", "done"],
            columnLabels: ["To Do", "In Progress", "Done"],
          };
          break;
        case "timer":
          obj = {
            ...base, type: "timer",
            x: worldX - 70, y: worldY - 50,
            w: 140, h: 100,
            durationSec: 300, // 5-minute default
            running: false,
            remainingSec: 300,
            label: "Timer",
          };
          break;
        case "voting":
          obj = {
            ...base, type: "voting",
            x: worldX - 140, y: worldY - 90,
            w: 280, h: 180,
            question: "How would you estimate this?",
            options: ["1", "2", "3", "5", "8", "13", "?", "☕"],
            votes: {},
            revealed: false,
          };
          break;
        default:
          break;
      }
      if (obj) {
        upsert(obj);
        // After creating an object, revert to select so we don't keep spawning more.
        setTool("select");
        // Auto-enter edit mode for text-bearing objects so the user can
        // type immediately after creation (Miro/Figma convention).
        // Without this, a freshly-created sticky requires a separate
        // double-click before text input works — users were reporting
        // "I can't type in stickies" because they assumed creating one
        // gave focus to it.
        if (obj.type === "sticky" || obj.type === "text" || obj.type === "card") {
          setSelection([obj.id]);
          setEditingObjectId(obj.id);
        }
      }
    },
    // `objects` is included so newly-added items always land above the
    // current top of the board (see nextZAbove). The deps change on every
    // edit, but addObjectAt isn't passed to a memoized child, so this is
    // cheap.
    [boardId, stickyColor, tool, upsert, setTool, objects, setSelection, setEditingObjectId],
  );

  // ─── Pointer down on empty canvas ────────────────────────────────────
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Read-only mode — allow pan via middle-mouse but no other
      // pointer-down side-effects (no marquee, no draw, no comment-pin
      // creation, etc.).
      if (readOnly) {
        if (e.button === 1) {
          isPanningRef.current = true;
          lastPointerRef.current = { x: e.clientX, y: e.clientY };
          viewportRef.current?.setPointerCapture(e.pointerId);
        }
        return;
      }
      const target = e.target as HTMLElement;
      // Click landed on an object — let its handler deal with it.
      if (target !== viewportRef.current && target !== viewportRef.current?.firstChild) return;

      const middleButton = e.button === 1;
      const shouldPan = tool === "hand" || middleButton || spaceHeldRef.current;
      if (shouldPan) {
        isPanningRef.current = true;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        viewportRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      if (tool === "select") {
        // Start a marquee — additive when shift is held so the user can
        // grow an existing selection by rubber-banding more objects.
        // ALT-DRAG = lasso (freeform polygon). Holding Alt at pointer-
        // down switches the marquee into lasso mode; the move handler
        // appends points, the up handler does polygon hit-test.
        const world = clientToWorld(e.clientX, e.clientY);
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const lasso = e.altKey;
        if (!additive) clearSelection();
        setMarquee({
          startWorld: world,
          currentWorld: world,
          initialSelection: additive ? selection : [],
          additive,
          ...(lasso ? { lassoPoints: [world.x, world.y] } : {}),
        });
        viewportRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      const world = clientToWorld(e.clientX, e.clientY);

      // ─── Drag-to-draw: line / arrow / freehand ───────────────────────
      if (tool === "line" || tool === "arrow") {
        const id = `wb_${Math.random().toString(36).slice(2, 11)}`;
        const now = new Date().toISOString();
        const topZ = nextZAbove(objects);
        setDrawing({
          id, boardId, type: tool,
          x: world.x, y: world.y, w: 0, h: 0,
          stroke: "#94a3b8", strokeWidth: 2,
          version: 1, z: topZ, createdAt: now, updatedAt: now,
        });
        viewportRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      if (tool === "freehand") {
        const id = `wb_${Math.random().toString(36).slice(2, 11)}`;
        const now = new Date().toISOString();
        const topZ = nextZAbove(objects);
        setDrawing({
          id, boardId, type: "freehand",
          x: world.x, y: world.y, w: 0, h: 0,
          // Pen state: start with a single point. Move handler will
          // append until pointerup commits the smoothed contour.
          points: [world.x, world.y],
          stroke: "#e5e7eb", strokeWidth: 3,
          version: 1, z: topZ, createdAt: now, updatedAt: now,
        });
        viewportRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      // ─── Connector tool — click empty canvas cancels the pending source.
      if (tool === "connector" && pendingConnectorFromId) {
        setPendingConnectorFromId(null);
        return;
      }

      // ─── Comment tool — click anywhere on the canvas to drop a new
      // thread pin. The drawer opens immediately so the user can type
      // the first reply. Reverts to Select tool after.
      if (tool === "comment") {
        const threadId = `wbc_${Math.random().toString(36).slice(2, 11)}`;
        upsertCommentThread({
          id: threadId,
          boardId,
          x: world.x,
          y: world.y,
          comments: [],
        });
        setActiveCommentThreadId(threadId);
        setTool("select");
        return;
      }

      // Single-click shape / sticky / text / frame add via the existing helper.
      addObjectAt(world.x, world.y);
    },
    [
      tool,
      addObjectAt,
      clearSelection,
      clientToWorld,
      selection,
      setMarquee,
      setDrawing,
      pendingConnectorFromId,
      setPendingConnectorFromId,
      objects,
      boardId,
      upsertCommentThread,
      setTool,
    ],
  );

  // ─── Pointer move — pan, marquee, drag, resize ───────────────────────
  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Pan needs the previous pointer to compute delta — but we also
      // capture the latest pointer position for ad-hoc UI that wants
      // to spawn at the cursor (chat composer "/", emoji reactions
      // "1-6"). Capture BEFORE the early-return so non-pan paths
      // also get fresh ref state.
      const prev = lastPointerRef.current;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      // Pan has priority — it's the only mode that uses the prev value.
      if (isPanningRef.current && prev) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        throttledSetCamera(panBy(camera, dx, dy));
        return;
      }

      const world = clientToWorld(e.clientX, e.clientY);

      // Broadcast cursor to peers (throttled inside useCanvasPresence to
      // ~16 fps to stay under Supabase's 10-events/sec budget).
      publish({ cursor: world });

      // Track cursor for connector preview when a source is pending.
      if (pendingConnectorFromId) {
        setPreviewCursor(world);
      }

      // ─── Drawing in progress ─────────────────────────────────────────
      if (drawing) {
        if (drawing.type === "line" || drawing.type === "arrow") {
          // w/h carry the dx/dy to the line endpoint. Shift constrains to
          // 45°/90° for tidier diagrams.
          let dx = world.x - drawing.x;
          let dy = world.y - drawing.y;
          if (e.shiftKey) {
            const ax = Math.abs(dx);
            const ay = Math.abs(dy);
            if (ax > ay * 2) dy = 0;
            else if (ay > ax * 2) dx = 0;
            else { const m = Math.max(ax, ay); dx = Math.sign(dx) * m; dy = Math.sign(dy) * m; }
          }
          setDrawing({ ...drawing, w: dx, h: dy });
        } else if (drawing.type === "freehand") {
          // Append point only if it moved enough — skips noise from a
          // jittery trackpad. ~1 world-px threshold.
          const pts = drawing.points;
          const lastX = pts[pts.length - 2];
          const lastY = pts[pts.length - 1];
          if (Math.hypot(world.x - lastX, world.y - lastY) >= 1) {
            const nextPts = pts.concat([world.x, world.y]);
            // Recompute bbox so the preview's bounding rect matches the
            // committed object's bbox at every step.
            const bbox = boundingBoxOfFlatPoints(nextPts);
            setDrawing({
              ...drawing,
              points: nextPts,
              x: bbox.x,
              y: bbox.y,
              w: bbox.w,
              h: bbox.h,
            });
          }
        }
        return;
      }

      // Marquee in progress
      if (marquee) {
        const lassoActive = !!marquee.lassoPoints;
        // For lasso, append the latest point ONLY if it's far enough
        // from the last one — avoids 3000-point paths on a slow drag.
        // Hard cap at LASSO_MAX_POINTS to prevent runaway memory + the
        // O(N²) hit-test cost on a malicious 10k-point payload.
        const LASSO_MAX_POINTS = 1000; // 1000 (x,y) pairs = 2000 numbers
        let nextLasso: number[] | undefined = marquee.lassoPoints;
        if (lassoActive && nextLasso && nextLasso.length < LASSO_MAX_POINTS * 2) {
          const lastX = nextLasso[nextLasso.length - 2];
          const lastY = nextLasso[nextLasso.length - 1];
          const dx = world.x - lastX;
          const dy = world.y - lastY;
          // Min distance in world units, divided by zoom so it stays
          // ~3 screen pixels at any zoom. Bigger min-distance on bigger
          // lassos to amortise the rising hit-test cost.
          const sizeFactor = 1 + nextLasso.length / 400;
          const minDist = (3 * sizeFactor) / Math.max(0.001, camera.zoom);
          if (dx * dx + dy * dy > minDist * minDist) {
            nextLasso = [...nextLasso, world.x, world.y];
          }
        }
        setMarquee({
          ...marquee,
          currentWorld: world,
          ...(nextLasso ? { lassoPoints: nextLasso } : {}),
        });
        // Compute selection: lasso uses point-in-polygon, marquee uses
        // AABB intersection.
        const hit: string[] = [];
        if (lassoActive && nextLasso && nextLasso.length >= 6) {
          for (const o of objects) {
            if (rectOverlapsPolygon({ x: o.x, y: o.y, w: o.w, h: o.h }, nextLasso)) hit.push(o.id);
          }
        } else {
          const rect = rectFromCorners(marquee.startWorld, world);
          for (const o of objects) {
            if (aabbIntersect(rect, { x: o.x, y: o.y, w: o.w, h: o.h })) hit.push(o.id);
          }
        }
        const next = marquee.additive
          ? Array.from(new Set([...marquee.initialSelection, ...hit]))
          : hit;
        // Only update selection if it actually changed (avoid render storms).
        if (next.length !== selection.length || next.some((id, i) => selection[i] !== id)) {
          setSelection(next);
        }
        return;
      }

      // Drag in progress — move all selected by world delta with optional
      // snap-to-grid (Cmd/Ctrl toggles) and snap-to-object alignment guides.
      if (drag) {
        let dx = world.x - drag.startWorld.x;
        let dy = world.y - drag.startWorld.y;
        const ids = Object.keys(drag.initialRects);

        // Compute the dragged group's union bbox at the proposed position.
        // Snap math operates on this union so multi-select drag locks the
        // whole group to a single guide line at once.
        const first = drag.initialRects[ids[0]];
        let minX = first.x + dx, minY = first.y + dy;
        let maxX = minX + first.w, maxY = minY + first.h;
        for (let i = 1; i < ids.length; i++) {
          const r = drag.initialRects[ids[i]];
          const nx = r.x + dx;
          const ny = r.y + dy;
          if (nx < minX) minX = nx;
          if (ny < minY) minY = ny;
          if (nx + r.w > maxX) maxX = nx + r.w;
          if (ny + r.h > maxY) maxY = ny + r.h;
        }
        const proposedUnion = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

        // Snap-to-grid: round the union's top-left to the nearest grid cell.
        // Cmd/Ctrl inverts the saved preference so users can temporarily
        // override either direction.
        const gridFlip = e.metaKey || e.ctrlKey;
        const gridActive = snapToGridEnabled !== gridFlip;
        if (gridActive) {
          const snapped = snapToGridFn({ x: proposedUnion.x, y: proposedUnion.y }, DEFAULT_GRID_SIZE);
          dx += snapped.x - proposedUnion.x;
          dy += snapped.y - proposedUnion.y;
          proposedUnion.x = snapped.x;
          proposedUnion.y = snapped.y;
        }

        // Snap-to-objects: compare against all visible objects EXCEPT the
        // ones being dragged. The engine returns a snapped rect + guide
        // segments to render.
        if (snapToObjectsEnabled) {
          const draggingSet = new Set(ids);
          const others = objects
            .filter((o) => !draggingSet.has(o.id))
            .map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
          // Zoom-adjusted tolerance — the default (6 world units) feels
          // wider when zoomed out and narrower when zoomed in. Dividing
          // by camera.zoom keeps the snap feel constant at ~6 screen
          // pixels regardless of zoom level. Clamped to a minimum so
          // we don't end up with sub-pixel snap windows at extreme zoom.
          const zoomAdjustedTol = Math.max(2, DEFAULT_GUIDE_TOLERANCE / (camera.zoom || 1));
          const { rect: snappedRect, guides } = snapToObjectsFn(proposedUnion, others, zoomAdjustedTol);
          dx += snappedRect.x - proposedUnion.x;
          dy += snappedRect.y - proposedUnion.y;
          if (guides.length > 0 || dragGuides.length > 0) setDragGuides(guides);
        } else if (dragGuides.length > 0) {
          setDragGuides([]);
        }

        const updates: WhiteboardObject[] = [];
        const now = new Date().toISOString();
        for (const id of ids) {
          const initial = drag.initialRects[id];
          const obj = objectsById.get(id);
          if (!obj) continue;
          updates.push({ ...obj, x: initial.x + dx, y: initial.y + dy, updatedAt: now });
        }
        if (updates.length > 0) upsertMany(updates);
        return;
      }

      // Rotation in progress — compute pointer angle relative to the
      // union centre; the delta from the initial angle is added to
      // each object's initial rotation. Shift snaps to 15° increments.
      if (rotation) {
        const angleDeg = (Math.atan2(world.y - rotation.centerWorld.y, world.x - rotation.centerWorld.x) * 180) / Math.PI;
        let delta = angleDeg - rotation.startAngleDeg;
        if (e.shiftKey) delta = Math.round(delta / 15) * 15;
        const updates: WhiteboardObject[] = [];
        const now = new Date().toISOString();
        for (const [id, initRot] of Object.entries(rotation.initialRotations)) {
          const obj = objectsById.get(id);
          if (!obj) continue;
          // Normalise to (-180, 180]. The naive `((r+180)%360+360)%360-180`
          // produces -180 for r=-180 (left-open / right-closed reversal);
          // we explicitly map -180 → 180 so the interval is consistent.
          let r = initRot + delta;
          r = ((r + 180) % 360 + 360) % 360 - 180;
          if (r === -180) r = 180;
          updates.push({ ...obj, rotation: r, updatedAt: now } as WhiteboardObject);
        }
        if (updates.length === 1) upsert(updates[0]);
        else if (updates.length > 1) upsertMany(updates);
        return;
      }

      // Resize in progress — recompute target union bbox from the
      // handle's drag delta, then scale every initially-captured rect
      // proportionally so multi-object resize feels like a uniform
      // bounding-box scale (matches Miro/Figma).
      if (resize) {
        const dx = world.x - resize.startWorld.x;
        const dy = world.y - resize.startWorld.y;
        const union = resize.initialUnion ?? resize.initialRect;
        const initRects = resize.initialRects ?? { [resize.objectId]: resize.initialRect };
        // Compute new union bbox based on handle direction.
        let unx = union.x, uny = union.y, unw = union.w, unh = union.h;
        if (resize.handle.includes("e")) unw = Math.max(20, union.w + dx);
        if (resize.handle.includes("s")) unh = Math.max(20, union.h + dy);
        if (resize.handle.includes("w")) { unw = Math.max(20, union.w - dx); unx = union.x + (union.w - unw); }
        if (resize.handle.includes("n")) { unh = Math.max(20, union.h - dy); uny = union.y + (union.h - unh); }
        // Shift-constrain aspect ratio: snap to whichever dimension
        // changed proportionally more (so corner-drag-with-shift
        // preserves the union's original aspect ratio).
        if (e.shiftKey && union.w > 0 && union.h > 0) {
          const sx = unw / union.w;
          const sy = unh / union.h;
          const isCorner = resize.handle === "nw" || resize.handle === "ne" || resize.handle === "sw" || resize.handle === "se";
          if (isCorner) {
            const s = Math.max(sx, sy);
            // Anchor the OPPOSITE corner of the handle so the constrained
            // size grows away from it.
            const newW = union.w * s;
            const newH = union.h * s;
            if (resize.handle.includes("w")) unx = union.x + union.w - newW;
            if (resize.handle.includes("n")) uny = union.y + union.h - newH;
            unw = newW;
            unh = newH;
          }
        }
        const sx = union.w > 0 ? unw / union.w : 1;
        const sy = union.h > 0 ? unh / union.h : 1;
        const updates: WhiteboardObject[] = [];
        const now = new Date().toISOString();
        for (const [id, ir] of Object.entries(initRects)) {
          const obj = objectsById.get(id);
          if (!obj) continue;
          // Per-rect new x/y: keep its OFFSET from the union anchor scaled.
          const offX = ir.x - union.x;
          const offY = ir.y - union.y;
          const nx = unx + offX * sx;
          const ny = uny + offY * sy;
          const nw = Math.max(20, ir.w * sx);
          const nh = Math.max(20, ir.h * sy);
          updates.push({ ...obj, x: nx, y: ny, w: nw, h: nh, updatedAt: now } as WhiteboardObject);
        }
        if (updates.length === 1) {
          upsert(updates[0]);
        } else if (updates.length > 1) {
          upsertMany(updates);
        }
        return;
      }
    },
    [camera, throttledSetCamera, marquee, drag, resize, drawing, pendingConnectorFromId, objects, objectsById, selection, setSelection, setMarquee, setDrawing, upsert, upsertMany, clientToWorld, dragGuides, setDragGuides, snapToGridEnabled, snapToObjectsEnabled, publish],
  );

  // ─── Pointer up ──────────────────────────────────────────────────────
  const onCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isPanningRef.current = false;
    lastPointerRef.current = null;
    if (marquee) {
      setMarquee(null);
    }
    if (drag) {
      const ids = Object.keys(drag.initialRects);
      if (ids.length > 0) {
        // NOTE: pushSnapshot was already called at drag START — calling it
        // here would capture the post-drag state and undo would be a no-op.
        log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: ids.length, ids });
        // ─── Kanban drop-into-column (Phase 26) ─────────────────────
        // After a drag, snap any dropped Card to the Kanban column it
        // landed in. Without this, kanban frames are visual decoration
        // only. Cards dragged OUT of a kanban have their frameId cleared.
        const cardUpdates: WhiteboardObject[] = [];
        for (const id of ids) {
          const obj = objectsById.get(id);
          if (!obj || obj.type !== "card") continue;
          const cx = obj.x + obj.w / 2;
          const cy = obj.y + obj.h / 2;
          // Find a Kanban frame whose bounds contain the card's centre.
          const kanban = objects.find((o) =>
            o.type === "kanban" &&
            cx >= o.x && cx <= o.x + o.w &&
            cy >= o.y && cy <= o.y + o.h,
          );
          if (kanban && kanban.type === "kanban" && kanban.columns.length > 0) {
            const colWidth = kanban.w / kanban.columns.length;
            const colIdx = Math.min(
              kanban.columns.length - 1,
              Math.max(0, Math.floor((cx - kanban.x) / colWidth)),
            );
            const newStatus = kanban.columns[colIdx];
            if (obj.status !== newStatus || obj.frameId !== kanban.id) {
              cardUpdates.push({
                ...obj,
                status: newStatus,
                frameId: kanban.id,
                version: obj.version + 1,
                updatedAt: new Date().toISOString(),
              } as WhiteboardObject);
            }
          } else if (obj.frameId) {
            // Card moved out of its previously-containing kanban.
            const prev = objectsById.get(obj.frameId);
            if (prev?.type === "kanban") {
              cardUpdates.push({
                ...obj,
                frameId: undefined,
                version: obj.version + 1,
                updatedAt: new Date().toISOString(),
              } as WhiteboardObject);
            }
          }
        }
        if (cardUpdates.length > 0) {
          upsertMany(cardUpdates);
          log(CANVAS_ACTIONS.OBJECT_UPDATED, { count: cardUpdates.length, action: "kanban-drop" });
        }
      }
      setDrag(null);
      if (dragGuides.length > 0) setDragGuides([]);
    }
    if (resize) {
      // pushSnapshot was called at resize START — see onResizeHandlePointerDown.
      log(CANVAS_ACTIONS.OBJECT_UPDATED, { id: resize.objectId, action: "resize" });
      setResize(null);
    }
    if (rotation) {
      log(CANVAS_ACTIONS.OBJECT_UPDATED, {
        count: Object.keys(rotation.initialRotations).length,
        action: "rotate",
      });
      setRotation(null);
    }
    // Commit drawing-in-progress.
    if (drawing) {
      const isTrivial =
        (drawing.type === "line" || drawing.type === "arrow")
          ? Math.hypot(drawing.w, drawing.h) < 4
          : drawing.type === "freehand"
            ? drawing.points.length < 6
            : false;
      // A < 4-world-pixel "drag" is almost certainly a stray click; skip
      // committing it so the canvas doesn't accrete invisible 0-length
      // lines as users tap-and-release.
      if (!isTrivial) {
        pushSnapshot();
        upsert(drawing);
        log(CANVAS_ACTIONS.OBJECT_ADDED, { id: drawing.id, type: drawing.type });
        setSelection([drawing.id]);
      }
      setDrawing(null);
      // Snap back to Select after drawing so the user can immediately
      // reposition or restyle the new object — matches every other
      // canvas tool's UX.
      setTool("select");
    }
    viewportRef.current?.releasePointerCapture(e.pointerId);
  }, [marquee, drag, resize, drawing, setMarquee, setDrag, setResize, setDrawing, setTool, setSelection, upsert, log, dragGuides, setDragGuides, pushSnapshot]);

  // ─── Pointer down on an object — select + start drag ─────────────────
  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      // Read-only: allow selection (so viewers can highlight things to
      // talk about in chat) but block every mutating side-effect.
      if (readOnly) {
        setSelection([id]);
        return;
      }
      if (tool === "hand") return;

      // Connector tool — two-click flow.
      // First click: stash source object id. Second click on a *different*
      // object commits a connector between them; the cursor-tracking
      // useState above renders a dashed preview line in between.
      if (tool === "connector") {
        // Don't allow connectors to/from non-pinnable objects (free-hand,
        // text, embed); the user expectation is they snap to box-shaped
        // anchors.
        const target = objectsById.get(id);
        if (!target) return;
        const valid = ["sticky", "rect", "ellipse", "diamond", "triangle", "frame", "image"];
        if (!valid.includes(target.type)) return;
        if (!pendingConnectorFromId) {
          setPendingConnectorFromId(id);
          return;
        }
        if (pendingConnectorFromId === id) {
          // Same object clicked twice — clear the pending state.
          setPendingConnectorFromId(null);
          return;
        }
        // CRITICAL: re-check that the pending source still exists in the
        // current object set. The user could have deleted it while it was
        // pending (Delete key works even while the connector tool is
        // active). Without this check we'd persist a connector with a
        // dangling fromId that the renderer silently skips — visible only
        // as a phantom row in the workspace store that resurfaces if the
        // source id ever gets recycled.
        if (!objectsById.has(pendingConnectorFromId)) {
          setPendingConnectorFromId(null);
          return;
        }
        // Commit a new connector.
        const newId = `wb_${Math.random().toString(36).slice(2, 11)}`;
        const now = new Date().toISOString();
        upsert({
          id: newId,
          boardId,
          type: "connector",
          x: 0, y: 0, w: 0, h: 0,
          z: nextZAbove(objects),
          fromId: pendingConnectorFromId,
          toId: id,
          fromAnchor: "auto",
          toAnchor: "auto",
          routing: "orthogonal",
          arrowEnd: true,
          stroke: "#94a3b8",
          strokeWidth: 2,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        log(CANVAS_ACTIONS.OBJECT_ADDED, { id: newId, type: "connector" });
        setPendingConnectorFromId(null);
        setSelection([newId]);
        setTool("select");
        return;
      }

      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      // Group selection expansion: clicking any member of a group
      // selects all members of that group. Without this, groups are
      // purely cosmetic — group/ungroup shortcuts assign the field
      // but the field is never read on click. Hold a modifier to
      // bypass the expansion (select just the clicked member).
      const target = objectsById.get(id);
      const groupId = !additive && target?.groupId ? target.groupId : null;
      const groupMembers = groupId
        ? objects.filter((o) => o.groupId === groupId).map((o) => o.id)
        : null;

      // Decide the new selection list synchronously so we can also
      // start dragging immediately without waiting for state to flush.
      let nextSelection: string[];
      if (additive) {
        nextSelection = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
      } else if (groupMembers && groupMembers.length > 1) {
        nextSelection = groupMembers;
      } else if (!selection.includes(id)) {
        nextSelection = [id];
      } else {
        nextSelection = selection;
      }
      if (nextSelection !== selection) setSelection(nextSelection);
      // Start a drag (only with the select tool and at least one object selected).
      if (tool !== "select" || nextSelection.length === 0) return;
      const world = clientToWorld(e.clientX, e.clientY);
      const initialRects: Record<string, Rect> = {};
      let anyMovable = false;
      for (const sid of nextSelection) {
        const o = objectsById.get(sid);
        if (!o) continue;
        // Locked objects skip the drag — they can still be selected.
        if (o.locked) continue;
        anyMovable = true;
        initialRects[sid] = { x: o.x, y: o.y, w: o.w, h: o.h };
      }
      if (!anyMovable) return;
      // Push the undo snapshot BEFORE the drag starts mutating the store.
      // The pointer-move handler updates positions on every frame, so by
      // pointer-up the store is already at the post-drag state — snapshot
      // there would record post-drag and Cmd+Z would be a no-op.
      pushSnapshot();
      setDrag({ startWorld: world, initialRects });
      viewportRef.current?.setPointerCapture(e.pointerId);
    },
    [tool, selection, setSelection, clientToWorld, objectsById, setDrag, pendingConnectorFromId, setPendingConnectorFromId, upsert, boardId, objects, log, setTool, pushSnapshot],
  );

  /** Double-click on a sticky / text / shape → enter inline edit mode.
   * Only those types have an editable `content` field; line/arrow/
   * freehand/image/embed/frame ignore the gesture. Cancels any active
   * drag/marquee in flight (a double-click after a long click could
   * have started a drag). */
  const onObjectDoubleClick = useCallback(
    (id: string) => {
      const obj = objectsById.get(id);
      if (!obj) return;
      const editable = obj.type === "sticky" || obj.type === "text"
        || obj.type === "rect" || obj.type === "ellipse"
        || obj.type === "diamond" || obj.type === "triangle";
      if (!editable) return;
      if (obj.locked) return;
      // Bail out of any pre-edit gestures so the textarea isn't
      // fighting a drag mid-mount.
      setDrag(null);
      setMarquee(null);
      setEditingObjectId(id);
      // Make sure the object is selected so selection chrome lines up
      // with the editor (and so post-edit Esc clears something sane).
      if (!(selection.length === 1 && selection[0] === id)) {
        setSelection([id]);
      }
    },
    [objectsById, selection, setSelection, setDrag, setMarquee, setEditingObjectId],
  );

  /** Commit edited text into the workspace store, bump version so any
   * realtime peer sees the change, and exit edit mode. */
  const onCommitObjectEdit = useCallback(
    (id: string, text: string) => {
      const obj = objectsById.get(id);
      if (!obj) { setEditingObjectId(null); return; }
      // Skip the upsert when text is unchanged — prevents history clutter
      // and avoids a no-op realtime patch.
      const current = "content" in obj ? (obj as { content?: string }).content ?? "" : "";
      if (current !== text) {
        pushSnapshot();
        upsert({
          ...obj,
          content: text,
          version: obj.version + 1,
          updatedAt: new Date().toISOString(),
        } as WhiteboardObject);
        log(CANVAS_ACTIONS.OBJECT_UPDATED, { id, action: "edit-text" });
      }
      setEditingObjectId(null);
    },
    [objectsById, upsert, log, pushSnapshot, setEditingObjectId],
  );

  /** Align selected (movable) objects against their union bbox.
   * Locked objects are filtered out — the toolbar still works on the
   * remaining selection, matching Miro behaviour. */
  const onAlign = useCallback(
    (op: AlignOp) => {
      const movable = selection
        .map((id) => objectsById.get(id))
        .filter((o): o is WhiteboardObject => !!o && !o.locked);
      if (movable.length < 2) return;
      pushSnapshot();
      const result = alignFn(
        movable.map((o) => ({ id: o.id, rect: { x: o.x, y: o.y, w: o.w, h: o.h } })),
        op,
      );
      const updates = movable
        .filter((o) => result[o.id])
        .map((o) => ({
          ...o,
          x: result[o.id].x,
          y: result[o.id].y,
          version: o.version + 1,
          updatedAt: new Date().toISOString(),
        }));
      if (updates.length > 0) {
        upsertMany(updates);
        log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: updates.length, action: op });
      }
    },
    [selection, objectsById, upsertMany, log, pushSnapshot],
  );

  /** Distribute equal spacing between 3+ selected (movable) objects. */
  const onDistribute = useCallback(
    (op: DistributeOp) => {
      const movable = selection
        .map((id) => objectsById.get(id))
        .filter((o): o is WhiteboardObject => !!o && !o.locked);
      if (movable.length < 3) return;
      pushSnapshot();
      const result = distributeFn(
        movable.map((o) => ({ id: o.id, rect: { x: o.x, y: o.y, w: o.w, h: o.h } })),
        op,
      );
      const updates = movable
        .filter((o) => result[o.id])
        .map((o) => ({
          ...o,
          x: result[o.id].x,
          y: result[o.id].y,
          version: o.version + 1,
          updatedAt: new Date().toISOString(),
        }));
      if (updates.length > 0) {
        upsertMany(updates);
        log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: updates.length, action: op });
      }
    },
    [selection, objectsById, upsertMany, log, pushSnapshot],
  );

  /** Drop / paste-image handler. Accepts any image file, converts it
   * to a data URL via FileReader, and inserts a WhiteboardImage at
   * the drop world point. Multiple images stack 24 px apart. */
  const importImagesAt = useCallback(
    async (files: File[], worldOrigin: { x: number; y: number }) => {
      if (files.length === 0) return;
      pushSnapshot();
      const updates: WhiteboardObject[] = [];
      let topZ = 0;
      for (const o of objects) if (o.z > topZ) topZ = o.z;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const result = await fileToImage(f, f.name);
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.warn("[canvas] image import failed:", result.err);
          continue;
        }
        const obj = imageToObject(result.image, {
          x: worldOrigin.x + i * 24,
          y: worldOrigin.y + i * 24,
        });
        const id = `wb_${Math.random().toString(36).slice(2, 11)}`;
        updates.push({ ...obj, id, boardId, z: topZ + i + 1 } as WhiteboardObject);
      }
      if (updates.length > 0) {
        upsertMany(updates);
        log(CANVAS_ACTIONS.OBJECT_ADDED, { count: updates.length, action: "image-import" });
        logActivity("image-import", `${updates.length} image${updates.length === 1 ? "" : "s"} imported`);
        setSelection(updates.map((u) => u.id));
      }
    },
    [boardId, objects, upsertMany, log, pushSnapshot, setSelection, logActivity],
  );

  // Paste-from-clipboard wiring (Cmd+V on an image). Listens at the
  // window so it fires regardless of focus inside the canvas. We
  // intercept BEFORE the canvas-clipboard paste runs by checking for
  // image files first.
  //
  // Skip when:
  //   - A text input / textarea / contentEditable is focused (the
  //     focus owner should get first dibs on the paste).
  //   - A canvas object is in inline-edit mode (sticky / text edit).
  //   - The cursor-chat composer is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // Check the active element too — the event target can be the
      // window when nothing's focused.
      const active = typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      if (editingObjectId || chatComposerScreen) return;
      if (!e.clipboardData) return;
      const files = extractImageFiles(e.clipboardData.items, e.clipboardData.files);
      if (files.length === 0) return;
      e.preventDefault();
      // Paste at centre of viewport in world coords.
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const world = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      void importImagesAt(files, world);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importImagesAt, clientToWorld, editingObjectId, chatComposerScreen]);

  /** Patch the style fields of one or more selected objects from the
   * floating property panel. Pushes an undo snapshot once per batch,
   * version-bumps each object so realtime peers see the change, and
   * upserts in a single mutation to keep the diff-sync broadcast atomic. */
  const onPatchStyles = useCallback(
    (entries: { id: string; patch: Partial<WhiteboardObject> }[]) => {
      if (entries.length === 0) return;
      const updates: WhiteboardObject[] = [];
      for (const { id, patch } of entries) {
        const obj = objectsById.get(id);
        if (!obj || obj.locked) continue;
        updates.push({
          ...obj,
          ...patch,
          version: obj.version + 1,
          updatedAt: new Date().toISOString(),
        } as WhiteboardObject);
      }
      if (updates.length === 0) return;
      pushSnapshot();
      upsertMany(updates);
      log(CANVAS_ACTIONS.OBJECT_UPDATED, { count: updates.length, action: "style" });
    },
    [objectsById, upsertMany, log, pushSnapshot],
  );

  /** Click on a connector path — toggle selection (additive with Shift/Cmd).
   * Connectors don't have a draggable bbox, so we don't kick off a drag the
   * way object pointer-down does. Pure selection. */
  const onConnectorPointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      e.stopPropagation();
      if (tool !== "select") return;
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (additive) {
        toggleSelection(id, true);
      } else if (!(selection.length === 1 && selection[0] === id)) {
        setSelection([id]);
      }
    },
    [tool, selection, setSelection, toggleSelection],
  );

  // ─── Pointer down on a resize handle ─────────────────────────────────
  const onResizeHandlePointerDown = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      if (selection.length === 0) return;
      // Collect every (non-locked) selected object's initial rect so
      // multi-object resize can scale each one proportionally to the
      // union bbox change. Locked objects are excluded — the toolbar
      // still works for the remaining objects, matching the drag /
      // align convention.
      const objs = selection
        .map((id) => objectsById.get(id))
        .filter((o): o is WhiteboardObject => !!o && !o.locked);
      if (objs.length === 0) return;
      const initialRects: Record<string, Rect> = {};
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const o of objs) {
        initialRects[o.id] = { x: o.x, y: o.y, w: o.w, h: o.h };
        if (o.x < minX) minX = o.x;
        if (o.y < minY) minY = o.y;
        if (o.x + o.w > maxX) maxX = o.x + o.w;
        if (o.y + o.h > maxY) maxY = o.y + o.h;
      }
      const initialUnion: Rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      const world = clientToWorld(e.clientX, e.clientY);
      // Push undo snapshot BEFORE the resize starts mutating the store.
      // The pointer-move handler edits w/h on every frame; snapshotting
      // at pointer-up would record post-resize and undo would no-op.
      pushSnapshot();
      setResize({
        handle,
        startWorld: world,
        initialRect: initialRects[objs[0].id],
        objectId: objs[0].id,
        initialRects,
        initialUnion,
      });
      viewportRef.current?.setPointerCapture(e.pointerId);
    },
    [selection, objectsById, clientToWorld, setResize, pushSnapshot],
  );

  /** Keyboard rotation: increment every selected object's rotation
   * by the given delta. Used when the rotation slider has focus
   * (Tab to focus, ←/→ to rotate 1°, Shift+←/→ for 15°). Mirrors
   * the pointer-drag math but skips the centerWorld dance. */
  const onRotateByDelta = useCallback(
    (deltaDeg: number) => {
      const objs = selection
        .map((id) => objectsById.get(id))
        .filter((o): o is WhiteboardObject => !!o && !o.locked);
      if (objs.length === 0) return;
      pushSnapshot();
      const updates: WhiteboardObject[] = [];
      const now = new Date().toISOString();
      for (const o of objs) {
        let r = (o.rotation ?? 0) + deltaDeg;
        r = ((r + 180) % 360 + 360) % 360 - 180;
        if (r === -180) r = 180;
        updates.push({ ...o, rotation: r, updatedAt: now } as WhiteboardObject);
      }
      if (updates.length > 0) upsertMany(updates);
    },
    [selection, objectsById, upsertMany, pushSnapshot],
  );

  /** Pointer-down on the rotation handle. Captures the union centre,
   * the initial pointer angle relative to it, and the starting
   * rotation of every selected object. The pointer-move handler
   * subtracts these to compute the per-object delta. */
  const onRotateStart = useCallback(
    (e: React.PointerEvent) => {
      const objs = selection
        .map((id) => objectsById.get(id))
        .filter((o): o is WhiteboardObject => !!o && !o.locked);
      if (objs.length === 0) return;
      // Union centre in world coords.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const initialRotations: Record<string, number> = {};
      for (const o of objs) {
        initialRotations[o.id] = o.rotation ?? 0;
        if (o.x < minX) minX = o.x;
        if (o.y < minY) minY = o.y;
        if (o.x + o.w > maxX) maxX = o.x + o.w;
        if (o.y + o.h > maxY) maxY = o.y + o.h;
      }
      const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      const world = clientToWorld(e.clientX, e.clientY);
      // Angle in degrees from centre → pointer. Math.atan2 returns
      // radians; we keep degrees for the data model (matches the
      // existing `rotation` field convention).
      const startAngleDeg = (Math.atan2(world.y - center.y, world.x - center.x) * 180) / Math.PI;
      pushSnapshot();
      setRotation({
        centerWorld: center,
        startAngleDeg,
        initialRotations,
      });
      viewportRef.current?.setPointerCapture(e.pointerId);
    },
    [selection, objectsById, clientToWorld, setRotation, pushSnapshot],
  );

  const cursor =
    tool === "hand" ? "grab" :
    tool === "select" ? "default" :
    "crosshair";

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full overflow-hidden bg-bg select-none touch-none"
      onWheel={onWheel}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={onCanvasPointerUp}
      onDragOver={(e) => {
        // Let the browser know we accept the drop — without this the
        // default behaviour is to reject and the onDrop never fires.
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const files = extractImageFiles(e.dataTransfer.items, e.dataTransfer.files);
        if (files.length === 0) return;
        e.preventDefault();
        const world = clientToWorld(e.clientX, e.clientY);
        void importImagesAt(files, world);
      }}
      style={{ cursor }}
    >
      {/* Background grid */}
      {showGrid && <GridBackground camera={camera} viewportSize={size} />}

      {/* World-space layer — everything inside is positioned in world coords */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
        }}
      >
        <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>
          {/* Connector layer first so connectors render behind sticky/
              shape objects. Selected connectors get a glow handled inside
              the layer component. */}
          <ConnectorLayer
            objects={objects}
            selectedIds={selection}
            preview={
              pendingConnectorFromId && previewCursor
                ? { fromId: pendingConnectorFromId, toWorld: previewCursor }
                : null
            }
            onConnectorPointerDown={onConnectorPointerDown}
          />
          {objects
            .slice()
            .sort((a, b) => a.z - b.z)
            .map((o) => (
              <ObjectRenderer
                key={o.id}
                object={o}
                selected={selection.includes(o.id)}
                editing={editingObjectId === o.id}
                onPointerDown={onObjectPointerDown}
                onDoubleClick={onObjectDoubleClick}
                onCommitEdit={onCommitObjectEdit}
                onMutate={(id, patch) => onPatchStyles([{ id, patch }])}
                selfId={self.id}
              />
            ))}
          {/* In-progress drawing preview — rendered through the same
              renderer as committed objects so what-you-see-is-what-you-
              get during drag. */}
          {drawing && (
            <ObjectRenderer
              key="drawing-preview"
              object={drawing}
              selected={false}
            />
          )}
        </div>
      </div>

      {/* Selection outline + resize handles — drawn in screen space so
          1-px-wide borders stay 1-px-wide at any zoom.
          Resize handles now render for multi-select too (Phase 24);
          dragging a corner scales every selected object proportionally
          to the union bbox change. */}
      {selectionBbox && tool === "select" && (
        <SelectionHandles
          bbox={selectionBbox}
          camera={camera}
          showResizeHandles={selection.length >= 1}
          onHandlePointerDown={onResizeHandlePointerDown}
          onRotateStart={onRotateStart}
          onRotateByDelta={onRotateByDelta}
          currentRotationDeg={selection.length === 1
            ? (objectsById.get(selection[0])?.rotation ?? 0)
            : 0}
        />
      )}

      {/* Floating align toolbar — visible only when 2+ objects are
          selected, the select tool is active, and no in-flight gesture
          would compete with it. */}
      {selectionBbox && tool === "select" && selection.length >= 2 && !drag && !resize && !marquee && (
        <AlignToolbar
          selectionBbox={selectionBbox}
          camera={camera}
          canDistribute={selection.length >= 3}
          onAlign={onAlign}
          onDistribute={onDistribute}
        />
      )}

      {/* Property panel — visible whenever any object is selected and
          no in-flight gesture. Anchored ABOVE the selection bbox;
          AlignToolbar anchors BELOW so they don't overlap on multi-
          select. */}
      {selectionBbox && tool === "select" && selection.length >= 1 && !drag && !resize && !marquee && !editingObjectId && (
        <PropertyPanel
          selection={selection
            .map((id) => objectsById.get(id))
            .filter((o): o is WhiteboardObject => !!o)}
          selectionBbox={selectionBbox}
          camera={camera}
          viewportHeight={size.h}
          onPatch={onPatchStyles}
        />
      )}

      {/* Marquee — only renders while a marquee drag is in progress. */}
      {marquee && <Marquee marquee={marquee} camera={camera} />}

      {/* Alignment guides — only while a drag is producing snaps. */}
      {dragGuides.length > 0 && <AlignmentGuides guides={dragGuides} camera={camera} />}

      {/* Remote cursors + selection boxes from peers. Silent no-op when
          Supabase env vars aren't configured (solo mode). */}
      <CursorOverlay
        members={members}
        selfId={self.id}
        camera={camera}
        objectsById={objectsById}
      />

      {/* Cursor-chat composer — extracted into its own component so
          per-keystroke setState doesn't re-render the entire canvas
          viewport. Lives inside the viewport div (NOT the world-
          transform) so it doesn't scale with zoom. */}
      {chatComposerScreen && viewportRef.current && (
        <ChatComposer
          screen={chatComposerScreen}
          viewportRect={viewportRef.current.getBoundingClientRect()}
          onPublish={(text) => publish({ chatBubble: { text, expiresAt: Date.now() + 6_000 } })}
          onClose={() => setChatComposerScreen(null)}
        />
      )}

      {/* Presentation mode overlay. */}
      {presentationFrameIndex !== null && (
        <PresentationMode
          frames={orderedFrames as readonly Extract<WhiteboardObject, { type: "frame" }>[]}
          index={presentationFrameIndex}
          onPrev={() => setPresentationFrameIndex(Math.max(0, presentationFrameIndex - 1))}
          onNext={() => setPresentationFrameIndex(Math.min(orderedFrames.length - 1, presentationFrameIndex + 1))}
          onExit={() => setPresentationFrameIndex(null)}
        />
      )}

      {/* Presence chips — top-right corner. Clicking a chip toggles
          "follow user" so the camera tracks their viewport. The local
          user's own chip is filtered out. */}
      {members.length > 0 && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1" data-canvas-export-ignore="true">
          {members.filter((m) => m.id !== self.id).slice(0, 8).map((m) => {
            const isFollowing = followUserId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                title={isFollowing ? `Stop following ${m.name}` : `Follow ${m.name}`}
                aria-label={isFollowing ? `Stop following ${m.name}` : `Follow ${m.name}`}
                onClick={() => setFollowUserId(isFollowing ? null : m.id)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: m.color,
                  color: "#0b0f17",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  border: isFollowing ? "2px solid #00f0ff" : "2px solid #0b0f17",
                  marginLeft: -6,
                  cursor: "pointer",
                  boxShadow: isFollowing ? "0 0 8px rgba(0,240,255,0.6)" : undefined,
                }}
              >
                {m.name.charAt(0).toUpperCase()}
              </button>
            );
          })}
          {followUserId && (
            <button
              type="button"
              onClick={() => setFollowUserId(null)}
              aria-label="Stop following"
              title="Stop following"
              className="ml-1 text-[10px] uppercase font-mono text-accent hover:text-text px-2 py-1 rounded bg-surface/95 border border-accent"
            >
              following
            </button>
          )}
        </div>
      )}

      {/* AI-cluster outlines + comment pins are rendered in screen space
          (not under the world transform) because the components compute
          their own camera projection. Keeps the projection logic local
          to each overlay. */}
      {showAIPanel && clusters.length > 0 && (
        <ClusterOverlay clusters={clusters} camera={camera} />
      )}
      <CommentPins
        threads={commentThreads}
        objectsById={objectsById}
        camera={camera}
        activeThreadId={activeCommentThreadId}
        onPinClick={setActiveCommentThreadId}
      />

      {/* Mini-map — bottom-right, pan-to-click. */}
      {showMiniMap && (
        <MiniMap
          objects={objects}
          camera={camera}
          viewportSize={size}
          onPan={(wx, wy) => {
            // Centre camera on the clicked world point.
            setCamera({
              x: wx - size.w / 2 / camera.zoom,
              y: wy - size.h / 2 / camera.zoom,
              zoom: camera.zoom,
            });
          }}
        />
      )}

      {/* AI insights drawer */}
      {showAIPanel && (
        <AIInsightsPanel
          clusters={clusters}
          insights={insights}
          onSelectCluster={(ids) => setSelection(ids)}
          onClose={() => setShowAIPanel(false)}
        />
      )}

      {/* Comment thread drawer — only one open at a time. */}
      {activeCommentThread && (
        <CommentDrawer
          thread={activeCommentThread}
          onClose={() => setActiveCommentThreadId(null)}
        />
      )}

      {/* Connector-tool affordance — tiny banner top-centre so the user
          knows what the two-click flow does. Hidden once they've started. */}
      {tool === "connector" && !pendingConnectorFromId && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-xs px-3 py-1.5 rounded-full font-mono backdrop-blur-sm">
            Click the source object, then click the target
          </div>
        </div>
      )}
      {tool === "connector" && pendingConnectorFromId && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-xs px-3 py-1.5 rounded-full font-mono backdrop-blur-sm">
            Now click the target object · Esc to cancel
          </div>
        </div>
      )}

      {/* Empty-state hint */}
      {objects.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-sub text-sm font-mono opacity-60 text-center max-w-md px-4">
            <div className="font-bold text-text/80 mb-2">Empty board</div>
            <div>Pick a tool from the left toolbar (or press <kbd className="px-1 bg-surface border border-border rounded">N</kbd> for sticky) and click anywhere to add an object.</div>
            <div className="mt-3 text-xs">Hold <kbd className="px-1 bg-surface border border-border rounded">Space</kbd> + drag to pan · scroll to zoom · drag-select with the V tool</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Background grid ───────────────────────────────────────────────── */

// Wrapped in React.memo so the grid only re-renders when camera or
// viewport size *content* changes — not just because the parent
// WhiteboardCanvas re-rendered (e.g. on a selection change). The grid
// is cheap but the inline style object is large; saving the reconcile
// is worth the memo.
const GridBackground = memo(function GridBackgroundImpl({ camera, viewportSize }: { camera: { x: number; y: number; zoom: number }; viewportSize: { w: number; h: number } }) {
  // Major + minor grid, sized to current zoom. We draw via a CSS background
  // so it's free in terms of React reconciliation cost.
  const minor = 20 * camera.zoom;
  const major = minor * 5;
  const offsetX = (-camera.x * camera.zoom) % major;
  const offsetY = (-camera.y * camera.zoom) % major;
  if (viewportSize.w === 0) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundImage: `
          linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px),
          linear-gradient(rgba(148, 163, 184, 0.12) 1px, transparent 1px),
          linear-gradient(90deg, rgba(148, 163, 184, 0.12) 1px, transparent 1px)
        `,
        backgroundSize: `${minor}px ${minor}px, ${minor}px ${minor}px, ${major}px ${major}px, ${major}px ${major}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px`,
      }}
    />
  );
});
