"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject, WhiteboardCard } from "@/lib/stores/workspace-types";
import { panBy, zoomAt, fitToRects } from "@/lib/whiteboard/canvas-transform";
import { rafThrottle } from "@/lib/utils/throttle";
import { aabbIntersect, boundingBoxOfFlatPoints, rectFromCorners, rectUnion, rectOverlapsPolygon } from "@/lib/geometry/bbox";
import type { Rect } from "@/lib/geometry/bbox";
import { copyObjects, duplicateObjects, readClipboardObjects, wbId } from "@/lib/whiteboard/clipboard";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { defaultCanvasShortcuts, makeShortcutHandler } from "@/lib/whiteboard/keyboard";
import { snapToGrid as snapToGridFn, snapToObjects as snapToObjectsFn, buildSpatialIndex, DEFAULT_GRID_SIZE, DEFAULT_GUIDE_TOLERANCE, type SpatialIndex } from "@/lib/whiteboard/snap";
import { useCanvasUndoStack } from "../use-undo-stack";
import { useCanvasStore, type ResizeHandle } from "../use-canvas-store";
import { ObjectRenderer } from "./object-renderer";
import { Marquee } from "./marquee";
import { SelectionHandles } from "./selection-handles";
import { AlignToolbar } from "./align-toolbar";
import { PropertyPanel } from "./property-panel";
import { CardDetailModal } from "./card-detail-modal";
import { PresentationMode } from "./presentation-mode";
import { align as alignFn, distribute as distributeFn, type AlignOp, type DistributeOp } from "@/lib/whiteboard/align";
import { extractImageFiles, fileToImage, imageToObject } from "@/lib/whiteboard/image-import";
import { extractPdfFiles, pdfToImages, pdfPagesToObjects } from "@/lib/whiteboard/pdf-import";
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
  /** When true and `readOnly` is also true, commenter mode: viewers
   * cannot edit objects but CAN drop new comment threads. Ignored when
   * `readOnly` is false (editors always can). Phase 32. */
  canComment?: boolean;
}

const STICKY_DEFAULT = { w: 200, h: 160 };
const SHAPE_DEFAULT = { w: 160, h: 120 };
const TEXT_DEFAULT = { w: 240, h: 40 };

// Module-scope keymap for quick emoji reactions — hoisted out of the
// render path so the `EMOJI_KEYS` object isn't allocated on every render
// (and so the keydown effect's dependency tree doesn't need to list it).
const EMOJI_KEYS: Record<string, string> = {
  "1": "👍", "2": "❤️", "3": "😂", "4": "🎉", "5": "🤔", "6": "👀",
};

// Module-scope dimmed-wrapper style for tag-filter dimming. Hoisted out
// of the render path so a 1000-object board doesn't allocate 1000 fresh
// inline-style objects per render — React's shallow-style-diff
// reconciliation depends on referential stability to skip style writes.
const DIMMED_WRAPPER_STYLE: CSSProperties = {
  opacity: 0.25,
  transition: "opacity 120ms",
};

// Returns a fresh z that is strictly greater than every current object's z
// so newly-created objects always land on top of existing ones. Computed
// per-call from the live object list — the previous module-level counter
// reset to 1 on every page reload, sandwiching new objects UNDER existing
// ones with z > 2.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function nextZAbove(existing: readonly WhiteboardObject[]): number {
  if (existing.length === 0) return 1;
  let max = 0;
  for (const o of existing) if (o.z > max) max = o.z;
  return max + 1;
}

/**
 * Collision-resistant id for activity-log entries.
 *
 * The previous `act_${Date.now()}_${Math.random().slice(2,6)}` recipe
 * combined two coarse sources of entropy and could collide under rapid
 * bursts — a multi-paste operation that fires four `appendActivity`s
 * inside the same animation frame has the same Date.now() and only 16⁴
 * = 65 536 random suffixes, so duplicate ids did appear in stress
 * testing. `crypto.randomUUID` is available in every browser we target
 * and in modern Node test environments; we fall back to the wider
 * random suffix only for older runtimes / non-secure contexts.
 */
function makeActivityId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    // Strip dashes first — `crypto.randomUUID()` returns
    // `xxxxxxxx-xxxx-...` with a guaranteed dash at offset 8, so
    // `.slice(0, 12)` always produced ids like `act_xxxxxxxx-xxx` with
    // an interior dash. Stripping first yields a clean 12-char hex
    // suffix that round-trips through URL params / log filters.
    return `act_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
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
export function WhiteboardCanvas({ boardId, onViewportSize, readOnly = false, canComment = false }: WhiteboardCanvasProps) {
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
  // R11-fix: clear pendingConnectorFromId when the user switches away
  // from the connector tool. Previously: user clicks source object
  // (pendingConnectorFromId set), then clicks Sticky in the toolbar —
  // pendingConnectorFromId stayed populated, and the next click in
  // the connector tool would unexpectedly complete a stale connection
  // to an object that may have changed.
  useEffect(() => {
    if (tool !== "connector") {
      // Read via getState to avoid making this effect depend on the
      // setter (which is identity-stable but eslint complains).
      const cur = useCanvasStore.getState().pendingConnectorFromId;
      if (cur) useCanvasStore.getState().setPendingConnectorFromId(null);
    }
  }, [tool]);
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
  const setDragGuides = useCanvasStore((s) => s.setDragGuides);
  // Mirror of `dragGuides` for read access inside long-lived callbacks
  // (onCanvasPointerMove, pointer-up, visibility-change). The
  // selector subscription to `dragGuides` itself USED to live on the
  // parent, but the drag loop sets guides on every frame (~60 Hz)
  // and each set triggered a full re-render of the entire viewport.
  // The parent's subscription has been removed; the dedicated
  // <DragGuidesLayer> wrapper rendered below owns its own
  // subscription so only the SVG re-renders on each guide update.
  // The parent still needs a fresh read of the latest value to clear
  // it on visibility-change / pointer-up; we sync the ref via the
  // store's subscribe() API so reads stay fresh without a re-render.
  const dragGuidesRef = useRef(useCanvasStore.getState().dragGuides);
  // R11-fix: spatial index for snap candidates, built ONCE at
  // drag-start. Previously the snap path did `objects.filter().map()`
  // per pointer-move, allocating ~2000 rects/frame at 1000-object
  // boards × 60-120Hz pointer rate (~120k allocations/sec). The index
  // is invariant during the drag (the candidate set doesn't change as
  // the dragged rect moves) so building once at drag-start and
  // querying `nearby()` per move reduces snap work from O(N) to
  // O(local-density).
  const dragSnapIndexRef = useRef<SpatialIndex | null>(null);
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((s) => {
      dragGuidesRef.current = s.dragGuides;
    });
    return unsub;
  }, []);
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
  const tagFilter = useCanvasStore((s) => s.tagFilter);
  const [activeCommentThreadId, setActiveCommentThreadId] = useState<string | null>(null);
  // Card detail modal — set when the user presses Cmd+E with a single
  // card selected (or clicks the "Edit details" pill on the property
  // panel). Cleared on save / close. Phase 26.
  const [cardDetailId, setCardDetailId] = useState<string | null>(null);
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
      // Clear the cursor-chat composer so leftover text input from the
      // previous board doesn't surface over the new one. M20.
      setChatComposerScreen(null);
      // Cancel any in-flight lasso rAF + drop its accumulated points —
      // otherwise a board switch mid-lasso would fire the rAF on the
      // new board's objects, mutating the wrong selection.
      if (lassoRafRef.current != null) {
        cancelAnimationFrame(lassoRafRef.current);
        lassoRafRef.current = null;
      }
      lassoPointsRef.current = null;
      lastLassoWorldRef.current = null;
      // Reset all in-flight pointer-latch refs. Without these, a board
      // switch mid-pan leaves `isPanningRef` true — the next click on
      // the new board pans instead of starting a marquee. Same for
      // `spaceHeldRef` (a held space bar mid-switch persists as pan
      // mode on the new board) and the remote-focus latch (next focus
      // event on the new board could be ignored if the ref is still
      // pointing at the old board's last focus).
      isPanningRef.current = false;
      spaceHeldRef.current = false;
      lastAppliedFocusRef.current = null;
      // Clear ephemeral UI latches keyed to the previous board.
      setPreviewCursor(null);
      setCardDetailId(null);
      setActiveCommentThreadId(null);
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
    // Close the cursor-chat composer when the user switches tools.
    // Without this, an open chat composer survives a tool change and
    // floats over the new tool's affordances (e.g. switching from
    // select to sticky leaves a half-typed chat message blocking the
    // first sticky click).
    setChatComposerScreen(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // ─── Multiplayer: realtime diff-sync + presence (cursors / selection)
  // Mounting both hooks is a no-op when Supabase env vars aren't set
  // (use-room flips to local-only mode), so solo users pay zero cost.
  // Pass `readOnly` so viewer/commenter modes don't broadcast local
  // store mutations. Even if a UI handler bypasses its `readOnly` gate
  // (browser extension, etc.), the network-side broadcast is silenced.
  const { broadcastFocus, remoteFocus, userId: roomUserId } = useCanvasRoom({ toolId: "canvas", roomId: boardId, boardId, readOnly });

  // ─── Receive bring-everyone / spotlight broadcasts (Phase 27/29).
  // For "snap" we fit-to-rect the local camera. For "spotlight" we
  // store the rect and render a dimmed-surround overlay; camera stays
  // put so each peer keeps their own view but knows where to look.
  // NB: the actual useEffect that consumes `remoteFocus` lives AFTER
  // `size` is declared — otherwise we'd reference `size` before its
  // useState call (block-scoped TDZ).
  const [spotlightRect, setSpotlightRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const channelName = boardId ? `tool:canvas:presence:${boardId}` : null;
  // R11-fix: unify identities. useCanvasRoom uses localStorage-backed
  // `getOrCreateUser()` for patch authorship; useCanvasPresence previously
  // minted its OWN crypto.randomUUID(), so each human had TWO identities
  // (room.userId for patches, presence.id for cursor/selection). Echo-
  // suppression, activity-log authorship, follow-me, and reload all
  // broke at the seam. Pass the room's userId as the presence hint so
  // both layers agree on who this peer is.
  const { members, publish, self } = useCanvasPresence(channelName, { id: roomUserId });

  // Activity-log helper. Coalesces small per-keystroke events into
  // larger summaries by skipping no-op summaries and only logging
  // when the caller passes a non-empty `summary`.
  const logActivity = useCallback(
    (kind: string, summary: string) => {
      if (!summary || summary.length === 0) return;
      appendActivity({
        id: makeActivityId(),
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
  // Now that `size` is in scope, react to remoteFocus broadcasts.
  // `snap` mode fits-to-rect on the viewport; spotlight just stores
  // the rect for the overlay layer below.
  useEffect(() => {
    if (!remoteFocus) {
      setSpotlightRect(null);
      lastAppliedFocusRef.current = null;
      return;
    }
    if (remoteFocus.kind === "snap") {
      if (lastAppliedFocusRef.current === remoteFocus) {
        // Already snapped to this focus event; ignore size changes so a
        // window resize doesn't overwrite the user's local pan.
        return;
      }
      if (size.w > 0 && size.h > 0) {
        const cam = fitToRects([remoteFocus.rect], size.w, size.h, 0.15);
        if (cam) setCamera(cam);
        lastAppliedFocusRef.current = remoteFocus;
      }
      setSpotlightRect(null);
    } else {
      setSpotlightRect(remoteFocus.rect);
    }
  }, [remoteFocus, size.w, size.h, setCamera]);
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const spaceHeldRef = useRef(false);
  // Cached viewport DOMRect — refreshed on ResizeObserver + window-
  // scroll only. Reads in `clientToWorld` happen on every pointermove,
  // and `getBoundingClientRect()` forces a layout flush that showed up
  // as a 1–2 ms cost per move at 120-Hz pointer rates on Phase-26 perf
  // traces. Caching cuts it to a ref read.
  const viewportRectRef = useRef<DOMRect | null>(null);
  // Track the last applied remoteFocus event so a window-resize doesn't
  // re-snap the camera to the same focus on every size change. Without
  // this latch, the `remoteFocus` consumer re-fires on `size.w/h` deps
  // and overwrites the user's local pan. See H2.
  const lastAppliedFocusRef = useRef<unknown>(null);
  // Lasso fast-path — the lassoPoints array lives in a ref during the
  // gesture so per-pointer-move append/hit-test doesn't trigger a full
  // canvas re-render. We coalesce setMarquee calls to rAF cadence
  // (≤60 Hz) so the visual path catches up to what's already been
  // computed without blocking the input thread on a setState-rerender
  // ping-pong. Cleared on pointer-up. Phase 23 / fast-path Phase 26.
  const lassoPointsRef = useRef<number[] | null>(null);
  const lassoRafRef = useRef<number | null>(null);
  // Drag-to-create origin. When the user picks a shape/sticky/text/card/
  // frame tool and pointer-downs on the canvas, we stash the start world
  // point here and treat subsequent pointer-move events as a resize-while-
  // creating drag. drawing.x/y/w/h continuously reflects the normalised
  // (top-left + positive size) rect. createStartRef holds the original
  // pointer-down point so the move handler can re-derive the rect even
  // when the user drags up/left and the rect flips around the origin.
  const createStartRef = useRef<{ x: number; y: number } | null>(null);
  // Latest world coord seen on pointermove — written every event,
  // read inside the rAF callback so the visual update reflects the
  // CURRENT cursor position rather than the position captured when
  // the rAF was scheduled (which is up to 16 ms stale at 60 Hz and
  // worse when the main thread is busy).
  const lastLassoWorldRef = useRef<{ x: number; y: number } | null>(null);
  // Object lookup map for O(1) hit-test during drag.
  const objectsById = useMemo(() => {
    const m = new Map<string, WhiteboardObject>();
    for (const o of objects) m.set(o.id, o);
    return m;
  }, [objects]);
  // Top z across the board — refreshed only when the object array
  // identity changes. Replaces the prior `nextZAbove(objects)` calls,
  // which were O(n) per invocation and got hot on pointer-down for
  // line / arrow / freehand / connector creation. A 1000-object board
  // paid 1000 ops per new shape; now it pays them once per object-
  // array mutation (cheap) and reads `topZRef.current + 1` for every
  // create (O(1)).
  const topZRef = useRef(0);
  useEffect(() => {
    let max = 0;
    for (const o of objects) if (o.z > max) max = o.z;
    topZRef.current = max;
  }, [objects]);
  // Ref mirrors of the live object array + lookup map. The keyboard-
  // shortcut effect would otherwise re-register its `keydown` listener
  // on every drag frame (objects identity changes on every move), at
  // ~60 Hz. Stashing them in refs keeps the shortcut callback identity
  // stable while still seeing fresh state on every key press.
  const objectsRef = useRef(objects);
  useEffect(() => { objectsRef.current = objects; }, [objects]);
  const objectsByIdRef = useRef(objectsById);
  useEffect(() => { objectsByIdRef.current = objectsById; }, [objectsById]);
  // Cluster + insights — only computed while the AI panel is open so we
  // don't pay the k-means cost on every render. Memoised on objects so
  // movement re-runs clustering live.
  const clusters = useMemo(
    () => (showAIPanel ? clusterObjects(objects, { mode: "content" }) : []),
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
        // Stop the canvas-level keyboard handler from also handling
        // these keys — without this, ArrowRight nudged the current
        // selection AS the presentation cycled to the next frame, and
        // Esc cleared selection on the underlying canvas as it exited
        // presentation. Both handlers register on `window` so capture
        // order is registration order; we stop propagation defensively.
        e.stopPropagation();
        setPresentationFrameIndex(Math.min(orderedFrames.length - 1, presentationFrameIndex + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        setPresentationFrameIndex(Math.max(0, presentationFrameIndex - 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
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
  // Also caches the full DOMRect into `viewportRectRef` so the hot
  // `clientToWorld` callback can read rect.left/rect.top without
  // forcing a layout flush on every pointermove.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      viewportRectRef.current = r;
      const next = { w: r.width, h: r.height };
      setSize(next);
      onViewportSize?.(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Page-level scroll shifts the viewport's client-rect position
    // (rect.top changes) even though the element itself hasn't
    // resized — ResizeObserver alone misses that case. Listen for
    // scroll on the window in passive mode so we don't block native
    // smooth scrolling.
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", update);
    };
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
      if (marquee) {
        if (lassoRafRef.current != null) {
          cancelAnimationFrame(lassoRafRef.current);
          lassoRafRef.current = null;
        }
        lassoPointsRef.current = null;
        lastLassoWorldRef.current = null;
        setMarquee(null);
      }
      if (drawing) setDrawing(null);
      // Read guides via the ref instead of a subscribed selector so
      // this effect doesn't re-mount on every drag-frame guide update.
      if (dragGuidesRef.current.length > 0) setDragGuides([]);
      spaceHeldRef.current = false;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [drag, resize, rotation, marquee, drawing, setDrag, setResize, setRotation, setMarquee, setDrawing, setDragGuides]);

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
  // Cancel any in-flight rAF on unmount — otherwise a pending camera
  // update can fire after the component has unmounted and call
  // setCamera on a stale store reference. `rafThrottle` exposes a
  // `.cancel()` method that drops the pending frame.
  useEffect(() => () => throttledSetCamera.cancel?.(), [throttledSetCamera]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────
  // Wired here (rather than in canvas-client) so they see the live
  // selection from useCanvasStore and operate on the active board's
  // objects. The shortcut handler ignores keys typed inside input/
  // textarea/contenteditable elements so editing a sticky's text stays
  // unaffected. Esc cancels marquee + drag + resize even if focus is
  // outside the canvas.
  useEffect(() => {
    // All callbacks read `objects` / `objectsById` via refs so this
    // effect's dep array doesn't include either. The deps used to
    // contain `objects, objectsById` — both change identity on every
    // drag frame (objectsById is memoised on objects), so the effect
    // re-mounted its `keydown` listener at ~60 Hz during any drag.
    // Refs read the LIVE state at call time without rebinding.
    // Helpers used by multiple shortcuts.
    const bringForward = (step: number) => {
      const liveObjects = objectsRef.current;
      const sel = liveObjects.filter((o) => selection.includes(o.id));
      if (sel.length === 0) return;
      pushSnapshot();
      // Find actual top + bottom z across the board. The previous version
      // used `objects[0]?.z` for the bottom — that's the FIRST object in
      // insertion order, not the lowest-z one. After a few z-shuffles
      // it returns the wrong baseline and send-backward sometimes raises
      // instead of lowers.
      let topZ = -Infinity;
      let bottomZ = Infinity;
      for (const o of liveObjects) {
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
      const sel = objectsRef.current.filter((o) => selection.includes(o.id));
      if (sel.length === 0) return;
      pushSnapshot();
      const allLocked = sel.every((o) => o.locked);
      const updates = sel.map((o) => ({ ...o, locked: !allLocked, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };
    const groupSelection = () => {
      const sel = objectsRef.current.filter((o) => selection.includes(o.id));
      if (sel.length < 2) return;
      pushSnapshot();
      const gid = wbId("wbg");
      const updates = sel.map((o) => ({ ...o, groupId: gid, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };
    const ungroupSelection = () => {
      const sel = objectsRef.current.filter((o) => selection.includes(o.id) && o.groupId);
      if (sel.length === 0) return;
      pushSnapshot();
      const updates = sel.map((o) => ({ ...o, groupId: undefined, updatedAt: new Date().toISOString() }));
      upsertMany(updates);
    };

    // ReadOnly-gated wrapper: any callback wrapped here is a no-op in
    // viewer/commenter mode. Defense-in-depth — even if a key reaches
    // the handler, the mutation is silenced. Non-mutating shortcuts
    // (selectAll, copy, cancel) stay live so viewers can still
    // navigate and inspect.
    const guardMut = <Args extends unknown[]>(fn: (...args: Args) => void) =>
      (...args: Args) => { if (!readOnly) fn(...args); };
    const handler = makeShortcutHandler(
      defaultCanvasShortcuts({
        setTool: (t) => setTool(t as Parameters<typeof setTool>[0]),
        deleteSelected: guardMut(() => {
          if (selection.length === 0) return;
          pushSnapshot();
          // Capture types BEFORE the remove for a sane activity summary.
          const summary = selection.length === 1
            ? `Deleted ${objectsByIdRef.current.get(selection[0])?.type ?? "object"}`
            : `Deleted ${selection.length} objects`;
          removeMany(selection);
          log(CANVAS_ACTIONS.OBJECT_REMOVED, { count: selection.length, ids: selection });
          logActivity("deleted", summary);
          clearSelection();
        }),
        selectAll: () => setSelection(objectsRef.current.map((o) => o.id)),
        copy: () => {
          const sel = objectsRef.current.filter((o) => selection.includes(o.id));
          if (sel.length > 0) void copyObjects(sel);
        },
        cut: guardMut(() => {
          const sel = objectsRef.current.filter((o) => selection.includes(o.id));
          if (sel.length === 0) return;
          pushSnapshot();
          void copyObjects(sel);
          removeMany(selection);
          log(CANVAS_ACTIONS.OBJECT_REMOVED, { count: selection.length, ids: selection, action: "cut" });
          logActivity(
            "cut",
            sel.length === 1 ? `Cut ${sel[0].type}` : `Cut ${sel.length} objects`,
          );
          clearSelection();
        }),
        paste: guardMut(() => {
          void (async () => {
            const pasted = await readClipboardObjects(boardId);
            if (pasted.length === 0) return;
            pushSnapshot();
            // O(1) read via cached topZRef instead of scanning the
            // entire object list.
            const topZ = topZRef.current;
            const repositioned = pasted.map((p, i) => ({ ...p, z: topZ + i + 1 }));
            upsertMany(repositioned);
            log(CANVAS_ACTIONS.OBJECTS_PASTED, { count: repositioned.length });
            setSelection(repositioned.map((p) => p.id));
          })();
        }),
        duplicate: guardMut(() => {
          const sel = objectsRef.current.filter((o) => selection.includes(o.id));
          if (sel.length === 0) return;
          pushSnapshot();
          const dup = duplicateObjects(sel, boardId);
          const topZ = topZRef.current;
          const repositioned = dup.map((p, i) => ({ ...p, z: topZ + i + 1 }));
          upsertMany(repositioned);
          log(CANVAS_ACTIONS.OBJECTS_PASTED, { count: repositioned.length, action: "duplicate" });
          setSelection(repositioned.map((p) => p.id));
        }),
        bringForward: guardMut(() => bringForward(1)),
        sendBackward: guardMut(() => bringForward(-1)),
        toggleLock: guardMut(toggleLock),
        groupSelection: guardMut(groupSelection),
        ungroupSelection: guardMut(ungroupSelection),
        // Guard undo/redo against mid-interaction triggers AND against
        // readOnly mode (undo can't restore a state the local user
        // can't write back). If a drag / resize / marquee / drawing is
        // in flight, the canvas store has ephemeral state pointing at
        // the *current* object state, and applying an undo snapshot
        // would leave drag.initialRects referring to ids that may no
        // longer exist or have mismatched sizes — the rest of the
        // gesture would corrupt the board. Cancel the in-flight
        // interaction first; user can hit undo a second time to
        // actually step back.
        undo: guardMut(() => {
          if (drag || resize || rotation || marquee || drawing) return;
          undo();
        }),
        redo: guardMut(() => {
          if (drag || resize || rotation || marquee || drawing) return;
          redo();
        }),
        cancel: () => {
          // Single Esc: end whatever interaction is in progress; if none,
          // clear selection. Keeps the gesture chain predictable.
          if (drawing) { setDrawing(null); return; }
          if (pendingConnectorFromId) { setPendingConnectorFromId(null); return; }
          if (drag) { setDrag(null); return; }
          if (resize) { setResize(null); return; }
          if (rotation) { setRotation(null); return; }
          if (marquee) {
            if (lassoRafRef.current != null) {
              cancelAnimationFrame(lassoRafRef.current);
              lassoRafRef.current = null;
            }
            lassoPointsRef.current = null;
            lastLassoWorldRef.current = null;
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
    // `objects` and `objectsById` deliberately omitted — we read them
    // via refs above so the listener doesn't re-mount on every drag
    // frame (objects identity changes on every move during a drag,
    // which used to cost a full add/remove-listener round trip + a
    // re-allocation of the entire shortcut closure tree at ~60 Hz).
  }, [setTool, selection, removeMany, upsertMany, clearSelection, setSelection, boardId, drag, resize, rotation, marquee, drawing, pendingConnectorFromId, setDrag, setResize, setMarquee, setDrawing, setPendingConnectorFromId, log, logActivity, pushSnapshot, undo, redo, readOnly]);

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

  // ─── Cmd+Shift+B → toggle frame bookmark on the selected frame.
  // Bookmarks live in canvasStore.frameBookmarks (per-board persisted)
  // and surface as quick-jump entries in a future toolbar menu. The
  // shortcut is the primary affordance for now — Miro's equivalent is
  // "favourite frame" with no menu either.
  const toggleFrameBookmark = useCanvasStore((s) => s.toggleFrameBookmark);
  useEffect(() => {
    // Bookmarks live in canvas-store (not workspace-store) so they
    // aren't multiplayer-broadcast. Still gate on readOnly for
    // consistency with the "viewer cannot mutate state" contract —
    // bookmarks survive a mode change back to editor and would
    // otherwise leak through.
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key !== "B" && e.key !== "b") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (selection.length !== 1) return;
      const obj = objectsById.get(selection[0]);
      if (!obj || obj.type !== "frame") return;
      e.preventDefault();
      toggleFrameBookmark(boardId, obj.id);
      logActivity("bookmark", `Toggled bookmark on frame "${obj.label || obj.id}"`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, objectsById, boardId, toggleFrameBookmark, logActivity, readOnly]);

  // ─── Enter key on a selected sticky/text/card → enter edit mode.
  // Mirrors Miro/Figma convention: select an object, press Enter, start
  // typing. Without this, users who selected (but didn't double-click)
  // a sticky and tried to type saw nothing happen — the most common
  // "I can't type in stickies" complaint.
  useEffect(() => {
    // ReadOnly: viewer / commenter cannot enter inline edit mode via
    // Enter shortcut.
    if (readOnly) return;
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
  }, [selection, objectsById, editingObjectId, setEditingObjectId, readOnly]);

  // ─── Cmd+E — open the card detail modal for the currently-selected
  // single card. Mirrors Linear / Notion's "expand details" shortcut.
  useEffect(() => {
    // ReadOnly: viewers / commenters cannot open the card-detail
    // modal because the modal's Save button would mutate the store.
    // We could allow opening in read-mode, but the form has no
    // read-mode rendering, so block at the shortcut layer.
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (selection.length !== 1) return;
      const obj = objectsById.get(selection[0]);
      if (!obj || obj.type !== "card") return;
      // Don't re-open the modal for the SAME card if it's already
      // showing; users hitting Cmd+E twice meant to dismiss.
      if (cardDetailId === obj.id) return;
      e.preventDefault();
      setCardDetailId(obj.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, objectsById, readOnly, cardDetailId]);

  // ─── Cursor chat (/) + emoji reactions (1-6).
  // The "/" key opens a small composer floating at the current screen
  // cursor; type → Enter publishes a `chatBubble` on presence, Esc cancels.
  // Number keys 1-6 emit emoji reactions at the current world-cursor.
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
        // Bump version so peers receive the nudge — see C14.
        updates.push({ ...o, x: o.x + dx, y: o.y + dy, version: o.version + 1, updatedAt: new Date().toISOString() });
      }
      if (updates.length > 0) upsertMany(updates);
    };
    const onKey = (e: KeyboardEvent) => {
      // ReadOnly: viewer / commenter modes cannot nudge.
      if (readOnly) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (selection.length === 0) return;
      // Don't fight with presentation-mode frame navigation — when the
      // user is in presentation mode, arrow keys cycle frames instead
      // of nudging selection.
      if (presentationFrameIndex !== null) return;
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
  }, [selection, objectsById, upsertMany, readOnly, presentationFrameIndex]);

  // Zoom-to-cursor on wheel.
  // R8: React's synthetic wheel listener is PASSIVE in React 17+ so calling
  // `e.preventDefault()` is a no-op and the browser still scrolls the page
  // beneath the canvas (Firefox/Safari especially when canvas sits in a
  // scrollable parent). Attach a native non-passive listener instead via
  // the effect below so we can prevent default. Also normalises Firefox's
  // line-mode (deltaMode=1) and page-mode (deltaMode=2) deltas — bare
  // deltaY varies 1.5× across browsers, making zoom jumpy on Firefox.
  const onWheel = useCallback(() => { /* handled natively below */ }, []);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (presentationFrameIndex !== null) return;
      // Only consume wheel when the pointer is over the canvas viewport.
      e.preventDefault();
      const rect = viewportRectRef.current;
      if (!rect) return;
      const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // Normalise deltaMode: 0=pixel, 1=line (~16px each), 2=page.
      const pxDelta = e.deltaMode === 1
        ? e.deltaY * 16
        : e.deltaMode === 2
          ? e.deltaY * window.innerHeight
          : e.deltaY;
      // Clamp the per-event zoom factor so a runaway driver (some Linux
      // trackpads emit deltaY > 2000) can't multiply zoom by 20× in one
      // event. Final clamp still happens inside zoomAt via clampZoom.
      const factor = Math.max(0.2, Math.min(5, Math.pow(1.0015, -pxDelta)));
      throttledSetCamera(zoomAt(camera, focal, camera.zoom * factor));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [camera, throttledSetCamera, presentationFrameIndex]);

  // Convert client pointer event to world coords.
  //
  // Performance: `getBoundingClientRect()` forces a layout flush, and
  // this callback fires on every pointermove during a drag. Cache the
  // viewport rect in a ref and refresh it only when the viewport
  // actually resizes or the page scrolls. Layout-changing mutations
  // outside the viewport (sidebars opening, etc.) don't shift our
  // bounds because the viewport is in a positioned container.
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRectRef.current;
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
      const id = wbId("wb");
      const now = new Date().toISOString();
      // Use the cached top-z ref. `topZRef.current` is refreshed by an
      // effect on every object-array identity change, so this is O(1)
      // and stays correct after multi-paste / undo. We still read live
      // objects from the store inside `useWorkspaceStore.getState()`
      // elsewhere; here, the ref is sufficient.
      const base = { id, boardId, version: 1, z: topZRef.current + 1, createdAt: now, updatedAt: now };
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
            // Soft translucent fill so the shape has visual presence
            // when created. Previously shapes shipped as a thin gray
            // outline only — visually indistinguishable from background
            // grid lines on a dark theme, and easy to lose-track-of in
            // a busy board. The 12% alpha keeps it subtle so it
            // doesn't compete with stickies or filled shapes the user
            // explicitly colours.
            fill: "rgba(148, 163, 184, 0.12)",
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
        // Activity log entry — surfaces "Alex created sticky" in the
        // panel and feeds into the cross-tool notification stream.
        logActivity("added", `Created ${obj.type}`);
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
    // `objects` is deliberately omitted from deps — we read the live
    // array from the store inside the callback. Keeping it as a dep
    // forced a rebuild on every pointermove during a drag.
    [boardId, stickyColor, tool, upsert, setTool, setSelection, setEditingObjectId, logActivity],
  );

  // ─── Pointer down on empty canvas ────────────────────────────────────
  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Read-only mode — allow pan via middle-mouse but no other
      // pointer-down side-effects (no marquee, no draw, etc.). In
      // commenter mode we additionally allow dropping a new comment
      // thread by clicking on empty canvas — same flow as the comment
      // tool below.
      if (readOnly) {
        if (e.button === 1) {
          isPanningRef.current = true;
          lastPointerRef.current = { x: e.clientX, y: e.clientY };
          viewportRef.current?.setPointerCapture(e.pointerId);
          return;
        }
        if (canComment && e.button === 0) {
          const target = e.target as HTMLElement;
          // Only act on truly-empty clicks (not on an object).
          if (target === viewportRef.current || target === viewportRef.current?.firstChild) {
            // Use the cached viewport rect — `getBoundingClientRect()`
            // forces a layout flush, and the cached rect already
            // refreshes on ResizeObserver + window scroll.
            const rect = viewportRectRef.current;
            if (!rect) return;
            const world = {
              x: (e.clientX - rect.left - camera.x) / camera.zoom,
              y: (e.clientY - rect.top - camera.y) / camera.zoom,
            };
            const threadId = wbId("wbc");
            upsertCommentThread({
              id: threadId,
              boardId,
              x: world.x,
              y: world.y,
              comments: [],
            });
            setActiveCommentThreadId(threadId);
          }
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
        // Lasso fast-path: stash the seed point in the ref. Pointer-move
        // appends to the ref synchronously; setMarquee fires on rAF.
        if (lasso) {
          lassoPointsRef.current = [world.x, world.y];
        } else {
          lassoPointsRef.current = null;
        }
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
        const id = wbId("wb");
        const now = new Date().toISOString();
        // Use the cached top-z ref instead of `nextZAbove(objects)` which
        // was O(n) per pointer-down on the line/arrow tool.
        const topZ = topZRef.current + 1;
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
        const id = wbId("wb");
        const now = new Date().toISOString();
        // Same O(1) top-z lookup as line/arrow above.
        const topZ = topZRef.current + 1;
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
        const threadId = wbId("wbc");
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

      // ─── Drag-to-create: shape / sticky / text / frame / card ─────────
      // For tools that produce a rectangular object, start a draft and
      // resize it as the user drags. If the user simply clicks without
      // dragging, pointer-up falls back to the tool's default size
      // centred on the click — preserving the single-click UX.
      //
      // kanban/timer/voting are deliberately NOT drag-to-create because
      // they're composite widgets (multi-column layout, control row,
      // option grid) whose proportions only make sense at known sizes.
      if (
        tool === "sticky" ||
        tool === "rect" ||
        tool === "ellipse" ||
        tool === "diamond" ||
        tool === "triangle" ||
        tool === "text" ||
        tool === "frame" ||
        tool === "card"
      ) {
        const id = wbId("wb");
        const now = new Date().toISOString();
        const topZ = topZRef.current + 1;
        const baseProps = {
          id,
          boardId,
          version: 1,
          z: topZ,
          createdAt: now,
          updatedAt: now,
          x: world.x,
          y: world.y,
          w: 0,
          h: 0,
        };
        let draft: WhiteboardObject | null = null;
        if (tool === "sticky") {
          draft = { ...baseProps, type: "sticky", content: "", color: stickyColor };
        } else if (tool === "rect" || tool === "ellipse" || tool === "diamond" || tool === "triangle") {
          // Match the click-to-create default — soft translucent fill so
          // the drag-created shape has visual presence on release.
          draft = {
            ...baseProps,
            type: tool,
            stroke: "#94a3b8",
            strokeWidth: 1.5,
            fill: "rgba(148, 163, 184, 0.12)",
          };
        } else if (tool === "text") {
          draft = { ...baseProps, type: "text", content: "", fontSize: 18, color: "#e5e7eb", align: "left" };
        } else if (tool === "frame") {
          draft = { ...baseProps, type: "frame", label: "Frame" };
        } else if (tool === "card") {
          draft = { ...baseProps, type: "card", title: "New card", color: "#00f0ff" };
        }
        if (draft) {
          createStartRef.current = { x: world.x, y: world.y };
          setDrawing(draft);
          viewportRef.current?.setPointerCapture(e.pointerId);
          return;
        }
      }

      // Click-only creation for composite widgets (kanban, timer, voting)
      // — addObjectAt commits at default size and auto-edits text-bearing
      // objects internally.
      addObjectAt(world.x, world.y);
    },
    // `objects` deliberately omitted: the line/arrow/freehand branches
    // read the live z-baseline from `topZRef` (kept in sync via an effect),
    // and no other branch in this handler touches the object array
    // directly. Keeping `objects` in deps would rebuild this callback
    // ~60×/sec during a drag, defeating React's event-handler caching and
    // rebinding the pointer-down listener on every frame.
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
      boardId,
      upsertCommentThread,
      setTool,
      readOnly,
      canComment,
      camera.x,
      camera.y,
      camera.zoom,
      setActiveCommentThreadId,
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
        // Shape / sticky / text / frame / card drag-to-create: resize the
        // draft to the rect spanned by createStartRef → current pointer.
        // Normalises so x/y is always top-left and w/h is always positive,
        // even when the user drags up-left and the rect flips around the
        // start point. Shift constrains to a square.
        if (
          createStartRef.current &&
          (drawing.type === "sticky" ||
            drawing.type === "rect" ||
            drawing.type === "ellipse" ||
            drawing.type === "diamond" ||
            drawing.type === "triangle" ||
            drawing.type === "text" ||
            drawing.type === "frame" ||
            drawing.type === "card")
        ) {
          const sx = createStartRef.current.x;
          const sy = createStartRef.current.y;
          let dx = world.x - sx;
          let dy = world.y - sy;
          if (e.shiftKey) {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            dx = Math.sign(dx) * m;
            dy = Math.sign(dy) * m;
          }
          setDrawing({
            ...drawing,
            x: Math.min(sx, sx + dx),
            y: Math.min(sy, sy + dy),
            w: Math.abs(dx),
            h: Math.abs(dy),
          });
          return;
        }
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
        // For lasso, the points array lives in a ref so we can append
        // without re-rendering the entire canvas. We schedule an rAF
        // tick to push the ref into marquee state (≤60 Hz). Rectangle
        // marquee keeps the original pattern — it only needs
        // currentWorld + bbox, both cheap.
        const LASSO_MAX_POINTS = 1000; // 1000 (x,y) pairs = 2000 numbers
        if (lassoActive) {
          // Initialise ref on first lasso pointermove if we haven't yet.
          if (!lassoPointsRef.current) lassoPointsRef.current = marquee.lassoPoints ? marquee.lassoPoints.slice() : [world.x, world.y];
          const buf = lassoPointsRef.current;
          if (buf.length < LASSO_MAX_POINTS * 2) {
            const lastX = buf[buf.length - 2];
            const lastY = buf[buf.length - 1];
            const dx = world.x - lastX;
            const dy = world.y - lastY;
            // Min distance in world units, divided by zoom so it stays
            // ~3 screen pixels at any zoom. Bigger min-distance on bigger
            // lassos to amortise the rising hit-test cost.
            const sizeFactor = 1 + buf.length / 400;
            const minDist = (3 * sizeFactor) / Math.max(0.001, camera.zoom);
            if (dx * dx + dy * dy > minDist * minDist) {
              buf.push(world.x, world.y);
            }
          }
          // Stash the latest world coord for the rAF callback. We read
          // from the ref inside rAF so the visual update + hit-test see
          // the CURRENT cursor position, not the stale value captured
          // when the rAF was scheduled.
          lastLassoWorldRef.current = world;
          // Coalesce both the visual update AND the hit-test to rAF
          // cadence (≤60 Hz). Running point-in-polygon on every pointer
          // event (which can fire at 120+ Hz on modern trackpads) made
          // 200-object boards stutter. By moving it into rAF, the cost
          // is amortised to one polygon test per frame.
          if (lassoRafRef.current == null) {
            lassoRafRef.current = requestAnimationFrame(() => {
              lassoRafRef.current = null;
              const cur = lassoPointsRef.current;
              const latestWorld = lastLassoWorldRef.current;
              // Read fresh marquee from store — the closure value is
              // stale by the time this rAF fires, especially on slow
              // frames where multiple pointermoves enqueue between
              // scheduling and firing.
              const liveMarquee = useCanvasStore.getState().marquee;
              if (!cur || !latestWorld || !liveMarquee) return;
              setMarquee({
                ...liveMarquee,
                currentWorld: latestWorld,
                lassoPoints: cur.slice(),
              });
              // Hit-test against the current polygon at rAF cadence.
              if (cur.length >= 6) {
                const hit: string[] = [];
                for (const o of objects) {
                  if (rectOverlapsPolygon({ x: o.x, y: o.y, w: o.w, h: o.h }, cur)) hit.push(o.id);
                }
                const next = liveMarquee.additive
                  ? Array.from(new Set([...liveMarquee.initialSelection, ...hit]))
                  : hit;
                const liveSelection = useCanvasStore.getState().selection;
                if (next.length !== liveSelection.length || next.some((id, i) => liveSelection[i] !== id)) {
                  setSelection(next);
                }
              }
            });
          }
        } else {
          // Rectangle marquee — keep the per-event setMarquee. The
          // payload is tiny (4 numbers), no batching needed.
          setMarquee({
            ...marquee,
            currentWorld: world,
          });
          // Rect-marquee hit-test stays on the input thread — AABB
          // checks are O(1) per object, cheap even for 500-object
          // boards. Only lasso needs the rAF amortisation.
          const hit: string[] = [];
          const rect = rectFromCorners(marquee.startWorld, world);
          for (const o of objects) {
            if (aabbIntersect(rect, { x: o.x, y: o.y, w: o.w, h: o.h })) hit.push(o.id);
          }
          const next = marquee.additive
            ? Array.from(new Set([...marquee.initialSelection, ...hit]))
            : hit;
          if (next.length !== selection.length || next.some((id, i) => selection[i] !== id)) {
            setSelection(next);
          }
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
          // Zoom-adjusted tolerance — the default (6 world units) feels
          // wider when zoomed out and narrower when zoomed in. Dividing
          // by camera.zoom keeps the snap feel constant at ~6 screen
          // pixels regardless of zoom level. Clamped to a minimum so
          // we don't end up with sub-pixel snap windows at extreme zoom.
          const zoomAdjustedTol = Math.max(2, DEFAULT_GUIDE_TOLERANCE / (camera.zoom || 1));
          // R11-fix: query the pre-built spatial index from drag-start
          // instead of rebuilding the candidate array per pointer-move.
          // Fall back to a full walk if the index is missing (shouldn't
          // happen — drag-start always builds it — but keeps the snap
          // working defensively).
          let others: Rect[];
          if (dragSnapIndexRef.current) {
            others = dragSnapIndexRef.current.nearby(proposedUnion, zoomAdjustedTol);
          } else {
            const draggingSet = new Set(ids);
            others = objects
              .filter((o) => !draggingSet.has(o.id))
              .map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
          }
          const { rect: snappedRect, guides } = snapToObjectsFn(proposedUnion, others, zoomAdjustedTol);
          dx += snappedRect.x - proposedUnion.x;
          dy += snappedRect.y - proposedUnion.y;
          // Read via ref so this callback doesn't depend on dragGuides
          // (which mutates every frame during the drag itself).
          if (guides.length > 0 || dragGuidesRef.current.length > 0) setDragGuides(guides);
        } else if (dragGuidesRef.current.length > 0) {
          setDragGuides([]);
        }

        const updates: WhiteboardObject[] = [];
        const now = new Date().toISOString();
        for (const id of ids) {
          const initial = drag.initialRects[id];
          const obj = objectsById.get(id);
          if (!obj) continue;
          // BUMP VERSION per drag frame. Without this, peers running
          // an identical local drag at the same start-version would
          // tie on LWW and randomly clobber positions; AND peers don't
          // receive intermediate positions because computePatch
          // filters by version diff. Bumping per frame ensures every
          // movement is broadcast and that the writer's LWW always
          // wins for their own drag. (Reverts to the pre-drag version
          // are not possible mid-gesture; pushSnapshot at drag-start
          // captures the rollback point.)
          updates.push({
            ...obj,
            x: initial.x + dx,
            y: initial.y + dy,
            version: obj.version + 1,
            updatedAt: now,
          });
        }
        if (updates.length > 0) upsertMany(updates);
        return;
      }

      // Rotation in progress — compute pointer angle relative to the
      // union centre; the delta from the initial angle is added to
      // each object's initial rotation. Shift snaps to 15° increments.
      if (rotation) {
        // R11-fix: guard against atan2 indeterminate (0, 0) when the
        // pointer is dragged exactly through the union center. The
        // previous code computed `delta = atan2(0,0)=0 - startAngle`,
        // which yanked the selection to a fixed orientation for one
        // frame. Skip rotation update when pointer is within 1 world
        // unit of the center.
        const dy = world.y - rotation.centerWorld.y;
        const dx = world.x - rotation.centerWorld.x;
        if (Math.hypot(dx, dy) < 1) return;
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        // R11-fix: wrap delta to (−180, 180] so a tiny pointer move
        // across the ±180 boundary doesn't produce a 358° rotation
        // jump on the next frame.
        let delta = ((angleDeg - rotation.startAngleDeg + 540) % 360) - 180;
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
          // Bump version per rotate frame — same reasoning as drag-move
          // C14 fix. Without this, concurrent peer rotation produces
          // LWW ties + dropped frames.
          updates.push({ ...obj, rotation: r, version: obj.version + 1, updatedAt: now } as WhiteboardObject);
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
          // Bump version per resize frame — same C14 reasoning.
          updates.push({ ...obj, x: nx, y: ny, w: nw, h: nh, version: obj.version + 1, updatedAt: now } as WhiteboardObject);
        }
        if (updates.length === 1) {
          upsert(updates[0]);
        } else if (updates.length > 1) {
          upsertMany(updates);
        }
        return;
      }
    },
    // `dragGuides` is deliberately read via `dragGuidesRef` to keep the
    // callback identity stable across drag-frame guide mutations.
    [camera, throttledSetCamera, marquee, drag, resize, drawing, pendingConnectorFromId, objects, objectsById, selection, setSelection, setMarquee, setDrawing, upsert, upsertMany, clientToWorld, setDragGuides, snapToGridEnabled, snapToObjectsEnabled, publish],
  );

  // ─── Pointer up ──────────────────────────────────────────────────────
  const onCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isPanningRef.current = false;
    lastPointerRef.current = null;
    if (marquee) {
      // Cancel any pending lasso visual flush — the marquee is going
      // away so the rAF callback would set stale state.
      if (lassoRafRef.current != null) {
        cancelAnimationFrame(lassoRafRef.current);
        lassoRafRef.current = null;
      }
      lassoPointsRef.current = null;
      lastLassoWorldRef.current = null;
      setMarquee(null);
    }
    if (drag) {
      const ids = Object.keys(drag.initialRects);
      // Compute whether any pointer-down -> pointer-up cycle actually
      // moved anything in world space. A click-without-drag still
      // reaches this branch (mousedown on object selects + starts a
      // drag latch in pointer-down; releasing without moving leaves
      // initialRects == current rects). Without this guard, every
      // bare click on a selected object emitted "Moved sticky" into
      // the activity log, flooding it with noise.
      let movedAny = false;
      if (ids.length > 0) {
        for (const id of ids) {
          const obj = objectsById.get(id);
          if (!obj) continue;
          const init = drag.initialRects[id];
          if (Math.abs(obj.x - init.x) + Math.abs(obj.y - init.y) > 0.5) {
            movedAny = true;
            break;
          }
        }
      }
      if (ids.length > 0) {
        // NOTE: pushSnapshot was already called at drag START — calling it
        // here would capture the post-drag state and undo would be a no-op.
        if (movedAny) log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: ids.length, ids });
        // Per-drag activity log entry. The single-snapshot-at-end
        // approach naturally coalesces a 200-px move into ONE log
        // entry rather than 200 per-keystroke entries. Skip when the
        // drag was a zero-pixel click — see `movedAny` above.
        if (movedAny) {
          logActivity(
            "moved",
            ids.length === 1
              ? `Moved ${objectsById.get(ids[0])?.type ?? "object"}`
              : `Moved ${ids.length} objects`,
          );
        }
        // ─── Kanban drop-into-column (Phase 26) ─────────────────────
        // After a drag, snap any dropped Card to the Kanban column it
        // landed in. Without this, kanban frames are visual decoration
        // only. Cards dragged OUT of a kanban have their frameId cleared.
        // ReadOnly gate: viewers / commenters can never reach pointer-down
        // for drag, but defense-in-depth — skip the upsert path entirely.
        const cardUpdates: WhiteboardObject[] = [];
        if (!readOnly) for (const id of ids) {
          const obj = objectsById.get(id);
          if (!obj || obj.type !== "card") continue;
          const cx = obj.x + obj.w / 2;
          const cy = obj.y + obj.h / 2;
          // Find a Kanban frame whose bounds contain the card's centre.
          // R5: skip rotated kanban frames — the axis-aligned bounds
          // check no longer matches what the user sees on screen, so
          // drops land in a column the user didn't intend. Also prefer
          // the top-most (highest z) when frames overlap so the result
          // is deterministic, not insertion-order-dependent.
          const kanban = objects
            .filter((o) =>
              o.type === "kanban" &&
              (!o.rotation || o.rotation === 0) &&
              cx >= o.x && cx <= o.x + o.w &&
              cy >= o.y && cy <= o.y + o.h,
            )
            .sort((a, b) => b.z - a.z)[0];
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
          // R11-fix: propagate Card.status → linked Story.status when
          // the kanban-drop changed `obj.status`. Without this branch
          // the canvas-kanban view "moves" a card to Done while the
          // workspace Story stays in its old column → backlog tools +
          // burndown + velocity all see stale data. Bidirectional sync
          // does NOT loop: the signal-bridge fires `story.statusChanged`
          // off the upsert; canvas-client's listener calls upsertCard
          // with status that matches what we just wrote (no-op due to
          // version-equal LWW).
          const ws = useWorkspaceStore.getState();
          for (const updated of cardUpdates) {
            if (updated.type !== "card") continue;
            const ref = updated.sourceRef;
            if (!ref?.entityId || !updated.status) continue;
            if (ref.tool === "story" || ref.tool === "backlog") {
              const story = ws.stories?.find((s) => s.id === ref.entityId);
              if (story && story.status !== updated.status) {
                ws.upsertStory({ ...story, status: updated.status as typeof story.status });
              }
            }
          }
        }
      }
      // R11-fix: release the spatial index so the candidate rects can
      // be GC'd; next drag-start rebuilds with fresh objects.
      dragSnapIndexRef.current = null;
      setDrag(null);
      // Read guides via the ref instead of a subscribed selector.
      if (dragGuidesRef.current.length > 0) setDragGuides([]);
    }
    if (resize) {
      // pushSnapshot was called at resize START — see onResizeHandlePointerDown.
      log(CANVAS_ACTIONS.OBJECT_UPDATED, { id: resize.objectId, action: "resize" });
      const count = resize.initialRects ? Object.keys(resize.initialRects).length : 1;
      logActivity(
        "resized",
        count === 1
          ? `Resized ${objectsById.get(resize.objectId)?.type ?? "object"}`
          : `Resized ${count} objects`,
      );
      setResize(null);
    }
    if (rotation) {
      const count = Object.keys(rotation.initialRotations).length;
      log(CANVAS_ACTIONS.OBJECT_UPDATED, { count, action: "rotate" });
      logActivity(
        "rotated",
        count === 1 ? `Rotated 1 object` : `Rotated ${count} objects`,
      );
      setRotation(null);
    }
    // Commit drawing-in-progress.
    if (drawing) {
      // Shape / sticky / text / frame / card drag-to-create commit. If the
      // drag was trivial (< 4 world px in either dimension), fall back to
      // the tool's default size centred on the click — preserves single-
      // click UX. Otherwise enforce a usable minimum so a 1×1 drag doesn't
      // produce an invisible object.
      const isShapeCreate =
        createStartRef.current &&
        (drawing.type === "sticky" ||
          drawing.type === "rect" ||
          drawing.type === "ellipse" ||
          drawing.type === "diamond" ||
          drawing.type === "triangle" ||
          drawing.type === "text" ||
          drawing.type === "frame" ||
          drawing.type === "card");

      if (isShapeCreate && !readOnly) {
        const sx = createStartRef.current!.x;
        const sy = createStartRef.current!.y;
        const trivial = drawing.w < 4 && drawing.h < 4;
        let committed: WhiteboardObject = drawing;
        if (trivial) {
          // Single-click fallback — apply default size centred on the
          // click. Defaults chosen to match what addObjectAt produces
          // for the same tool.
          const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
            sticky: { w: STICKY_DEFAULT.w, h: STICKY_DEFAULT.h },
            rect: { w: SHAPE_DEFAULT.w, h: SHAPE_DEFAULT.h },
            ellipse: { w: SHAPE_DEFAULT.w, h: SHAPE_DEFAULT.h },
            diamond: { w: SHAPE_DEFAULT.w, h: SHAPE_DEFAULT.h },
            triangle: { w: SHAPE_DEFAULT.w, h: SHAPE_DEFAULT.h },
            text: { w: TEXT_DEFAULT.w, h: TEXT_DEFAULT.h },
            frame: { w: 640, h: 400 },
            card: { w: 200, h: 120 },
          };
          const d = DEFAULT_SIZE[drawing.type] ?? { w: 160, h: 120 };
          committed = {
            ...drawing,
            x: sx - d.w / 2,
            y: sy - d.h / 2,
            w: d.w,
            h: d.h,
          } as WhiteboardObject;
        } else {
          // Drag created a real rect. Enforce a usable minimum (40×30 or
          // 60×40 for big composite types) so a 5×5 drag still produces
          // something interactive.
          const MIN_W = drawing.type === "frame" ? 120 : 40;
          const MIN_H = drawing.type === "frame" ? 80 : 30;
          committed = {
            ...drawing,
            w: Math.max(drawing.w, MIN_W),
            h: Math.max(drawing.h, MIN_H),
          } as WhiteboardObject;
        }
        pushSnapshot();
        upsert(committed);
        log(CANVAS_ACTIONS.OBJECT_ADDED, { id: committed.id, type: committed.type });
        logActivity("added", `Created ${committed.type}`);
        setSelection([committed.id]);
        // Auto-enter edit mode for text-bearing objects so the user can
        // type immediately after creation (Miro/Figma convention).
        if (
          committed.type === "sticky" ||
          committed.type === "text" ||
          committed.type === "card"
        ) {
          setEditingObjectId(committed.id);
        }
        createStartRef.current = null;
        setDrawing(null);
        viewportRef.current?.releasePointerCapture(e.pointerId);
        setTool("select");
        return;
      }

      const isTrivial =
        (drawing.type === "line" || drawing.type === "arrow")
          ? Math.hypot(drawing.w, drawing.h) < 4
          : drawing.type === "freehand"
            ? drawing.points.length < 6
            : false;
      // A < 4-world-pixel "drag" is almost certainly a stray click; skip
      // committing it so the canvas doesn't accrete invisible 0-length
      // lines as users tap-and-release. Also gate on readOnly so a
      // viewer who somehow has `drawing` set (e.g. mode flipped
      // mid-stroke) cannot commit on release.
      if (!isTrivial && !readOnly) {
        pushSnapshot();
        upsert(drawing);
        log(CANVAS_ACTIONS.OBJECT_ADDED, { id: drawing.id, type: drawing.type });
        setSelection([drawing.id]);
      }
      createStartRef.current = null;
      setDrawing(null);
      // Snap back to Select after drawing so the user can immediately
      // reposition or restyle the new object — matches every other
      // canvas tool's UX.
      setTool("select");
    }
    viewportRef.current?.releasePointerCapture(e.pointerId);
    // `dragGuides` deliberately omitted — read via the ref so this
    // pointer-up callback isn't rebuilt on every drag-frame guide
    // mutation. The dep on `setDragGuides` is enough.
  }, [marquee, drag, resize, rotation, setRotation, drawing, setMarquee, setDrag, setResize, setDrawing, setTool, setSelection, upsert, upsertMany, log, logActivity, setDragGuides, pushSnapshot, objectsById, objects, readOnly]);

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
        const newId = wbId("wb");
        const now = new Date().toISOString();
        upsert({
          id: newId,
          boardId,
          type: "connector",
          x: 0, y: 0, w: 0, h: 0,
          // O(1) top-z read — replaces an O(n) scan of the full
          // object list on every connector commit.
          z: topZRef.current + 1,
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
      // R11-fix: build the snap spatial index ONCE for this drag.
      // The candidate set (every non-dragging object) is invariant
      // during the drag; rebuilding the rect array per pointer-move
      // is wasteful.
      const draggingSet = new Set(Object.keys(initialRects));
      const candidateRects: Rect[] = [];
      for (const o of objects) {
        if (draggingSet.has(o.id)) continue;
        candidateRects.push({ x: o.x, y: o.y, w: o.w, h: o.h });
      }
      dragSnapIndexRef.current = buildSpatialIndex(candidateRects);
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
      // ReadOnly: viewers / commenters cannot enter inline edit mode.
      // Without this gate, double-click opens the textarea overlay,
      // typing fires onCommit, and the mutation lands in the store.
      if (readOnly) return;
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
    [readOnly, objectsById, selection, setSelection, setDrag, setMarquee, setEditingObjectId],
  );

  /** Commit edited text into the workspace store, bump version so any
   * realtime peer sees the change, and exit edit mode. */
  const onCommitObjectEdit = useCallback(
    (id: string, text: string) => {
      // ReadOnly defense-in-depth: even though Enter/double-click are
      // gated, if an InlineEditor somehow surfaces (e.g. DOM hack),
      // refuse to commit the mutation. Still clear the edit flag so
      // the UI doesn't get stuck.
      if (readOnly) { setEditingObjectId(null); return; }
      const obj = objectsById.get(id);
      if (!obj) { setEditingObjectId(null); return; }
      // Pick the right field to write into based on object type. Sticky /
      // text / shape store editable text in `content`; frame / kanban /
      // timer use `label`; card uses `title`; voting uses `question`.
      // Previously this always wrote to `content`, so editing a frame's
      // label silently produced a phantom `content: text` field that
      // never rendered anywhere — the typed text vanished from the
      // user's perspective.
      const fieldByType: Record<string, "content" | "label" | "title" | "question"> = {
        sticky: "content",
        text: "content",
        rect: "content",
        ellipse: "content",
        diamond: "content",
        triangle: "content",
        frame: "label",
        kanban: "label",
        timer: "label",
        card: "title",
        voting: "question",
      };
      const field = fieldByType[obj.type] ?? "content";
      const rec = obj as unknown as Record<string, unknown>;
      const currentRaw = rec[field];
      const current = typeof currentRaw === "string" ? currentRaw : "";
      if (current !== text) {
        pushSnapshot();
        upsert({
          ...obj,
          [field]: text,
          version: obj.version + 1,
          updatedAt: new Date().toISOString(),
        } as WhiteboardObject);
        log(CANVAS_ACTIONS.OBJECT_UPDATED, { id, action: "edit-text" });
        // Activity log entry. Coalesce by truncating the preview to 40
        // chars so a 5kb sticky doesn't bloat the stream.
        const preview = text.trim().slice(0, 40);
        logActivity(
          "edited",
          preview
            ? `Edited ${obj.type}: "${preview}${text.length > 40 ? "…" : ""}"`
            : `Edited ${obj.type} (cleared text)`,
        );
      }
      setEditingObjectId(null);
    },
    [objectsById, upsert, log, logActivity, pushSnapshot, setEditingObjectId, readOnly],
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
      // Don't push an undo snapshot when there's nothing to align — that
      // bloats the undo stack with no-op entries the user has to Cmd+Z
      // past to reach a real edit. Snapshot only when we're about to
      // mutate the store.
      if (updates.length === 0) return;
      pushSnapshot();
      upsertMany(updates);
      log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: updates.length, action: op });
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
      // See onAlign — only snapshot when we have real updates.
      if (updates.length === 0) return;
      pushSnapshot();
      upsertMany(updates);
      log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: updates.length, action: op });
    },
    [selection, objectsById, upsertMany, log, pushSnapshot],
  );

  /** Drop / paste-image handler. Accepts any image file, converts it
   * to a data URL via FileReader, and inserts a WhiteboardImage at
   * the drop world point. Multiple images stack 24 px apart. */
  const importImagesAt = useCallback(
    async (files: File[], worldOrigin: { x: number; y: number }) => {
      // ReadOnly defense-in-depth: callers (drop, paste) are already
      // gated, but this is the place where an upsertMany would fire if
      // a future code path forgot the gate.
      if (readOnly) return;
      if (files.length === 0) return;
      pushSnapshot();
      const updates: WhiteboardObject[] = [];
      let topZ = 0;
      for (const o of objects) if (o.z > topZ) topZ = o.z;
      // Cumulative image-import quota. Each image is bounded individually
      // (IMAGE_MAX_BYTES ≈ 2.5 MB binary → ~3.4 MB encoded), but a drop
      // of 5 max-size images would still exceed the 5 MB localStorage
      // quota when serialised together. Track the running encoded total
      // and stop accepting images once we'd push the board past a
      // conservative 3.5 MB budget (matching the per-image cap).
      let cumulativeBytes = 0;
      let firstSkippedIdx = -1;
      const CUMULATIVE_BUDGET = 3.5 * 1024 * 1024;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const result = await fileToImage(f, f.name);
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.warn("[canvas] image import failed:", result.err);
          continue;
        }
        const encoded = result.image.src.length;
        if (cumulativeBytes + encoded > CUMULATIVE_BUDGET) {
          if (firstSkippedIdx === -1) firstSkippedIdx = i;
          continue;
        }
        cumulativeBytes += encoded;
        const obj = imageToObject(result.image, {
          x: worldOrigin.x + i * 24,
          y: worldOrigin.y + i * 24,
        });
        // wbId() produces a crypto-strong id with deterministic length —
        // avoids the variable-length truncated-Math.random fallback.
        const id = wbId();
        updates.push({ ...obj, id, boardId, z: topZ + i + 1 } as WhiteboardObject);
      }
      if (firstSkippedIdx !== -1) {
        const skippedCount = files.length - firstSkippedIdx;
        // eslint-disable-next-line no-console
        console.warn(`[canvas] skipped ${skippedCount} image(s) — board would exceed ~3.5 MB encoded total.`);
        logActivity(
          "image-import",
          `Imported ${updates.length} image(s); skipped ${skippedCount} to keep board under quota.`,
        );
      }
      if (updates.length > 0) {
        upsertMany(updates);
        log(CANVAS_ACTIONS.OBJECT_ADDED, { count: updates.length, action: "image-import" });
        if (firstSkippedIdx === -1) {
          logActivity("image-import", `${updates.length} image${updates.length === 1 ? "" : "s"} imported`);
        }
        setSelection(updates.map((u) => u.id));
      }
    },
    [boardId, objects, upsertMany, log, pushSnapshot, setSelection, logActivity, readOnly],
  );

  /** PDF drop handler (Phase 33). Each page rasterises to a JPEG data
   * URL and lands as a locked WhiteboardImage; users then annotate
   * with the normal freehand / sticky tools. pdfjs-dist is dynamic-
   * imported on first use so the bundle cost is opt-in. */
  const importPdfAt = useCallback(
    async (files: File[], worldOrigin: { x: number; y: number }) => {
      // ReadOnly defense-in-depth: same reasoning as importImagesAt.
      if (readOnly) return;
      if (files.length === 0) return;
      // PDFs can be heavy — render only the first one if a user drops
      // several. Multi-PDF drop is a niche case and rendering 5 PDFs
      // sequentially blocks the main thread for minutes.
      const file = files[0];
      let zBase = 0;
      for (const o of objects) if (o.z > zBase) zBase = o.z;
      // Snapshot BEFORE the long render — if we snapshotted after, any
      // user edits made while the PDF is rendering would be absorbed
      // into the undo entry and rolled back on Cmd+Z. Snapshotting
      // before is harmless when the render fails: it just adds one
      // no-op entry to the undo stack.
      pushSnapshot();
      // Progress hint so the user sees the render isn't frozen. Fires
      // every couple of pages — finer than that is just noise.
      const result = await pdfToImages(file, {
        onProgress: (current, total) => {
          if (current === 1 || current === total || current % 5 === 0) {
            logActivity("pdf-import", `Rendering PDF page ${current} of ${total}…`);
          }
        },
      });
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn("[canvas] PDF import failed:", result.err);
        logActivity("pdf-import", `PDF import failed: ${result.err}`);
        return;
      }
      const seeded = pdfPagesToObjects(result, boardId, worldOrigin, zBase);
      if (seeded.length === 0) return;
      upsertMany(seeded);
      log(CANVAS_ACTIONS.OBJECT_ADDED, { count: seeded.length, action: "pdf-import" });
      logActivity(
        "pdf-import",
        result.truncated
          ? `${seeded.length} of ${result.totalPages} pages imported from "${result.name}" (truncated at 30 pages)`
          : `${seeded.length} page${seeded.length === 1 ? "" : "s"} imported from "${result.name}"`,
      );
      // Pages land locked-by-default so freehand-over-PDF (the killer
      // use case) doesn't accidentally drag the page around. Tell the
      // user how to unlock when they need to reposition.
      logActivity("pdf-import", "PDF pages locked — Cmd+L to unlock if you need to move them.");
      setSelection([seeded[0].id]);
    },
    [boardId, objects, upsertMany, log, pushSnapshot, setSelection, logActivity, readOnly],
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
    // ReadOnly tier: viewer / commenter cannot paste images. The
    // canvas-shortcut paste path is also gated; this is the secondary
    // listener for window-level paste (image MIME on clipboard).
    if (readOnly) return;
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
      // Paste at centre of viewport in world coords. Use the cached
      // viewport rect rather than `getBoundingClientRect()` — same
      // hot-path layout-flush reasoning as `clientToWorld`. The cache
      // refreshes on resize / scroll so it's always current.
      const rect = viewportRectRef.current;
      if (!rect) return;
      const world = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      void importImagesAt(files, world);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importImagesAt, clientToWorld, editingObjectId, chatComposerScreen, readOnly]);

  /** Patch the style fields of one or more selected objects from the
   * floating property panel. Pushes an undo snapshot once per batch,
   * version-bumps each object so realtime peers see the change, and
   * upserts in a single mutation to keep the diff-sync broadcast atomic. */
  const onPatchStyles = useCallback(
    (entries: { id: string; patch: Partial<WhiteboardObject> }[]) => {
      // ReadOnly: viewers / commenters cannot patch styles even
      // though the PropertyPanel is hidden — defense-in-depth against
      // hacked DOM injecting a panel.
      if (readOnly) return;
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
    [objectsById, upsertMany, log, pushSnapshot, readOnly],
  );

  /**
   * Stable per-object onMutate adapter — passed to every <ObjectRenderer>
   * so the memoised renderer doesn't blow its cache on identity churn.
   *
   * Previously the JSX created a fresh `(id, patch) => onPatchStyles([{id, patch}])`
   * arrow on every parent render, which meant every ObjectRenderer received
   * a NEW `onMutate` prop reference each tick. React's `memo()` then bailed
   * to re-render even when the underlying object hadn't changed — defeating
   * the renderer's memoisation entirely. With 1000 objects on the board
   * and a 60 Hz drag re-rendering the parent on every frame, that was
   * 60_000 ObjectRenderer reconciliations per second. Stabilising the
   * callback identity drops that to just the ~20 selected objects that
   * actually changed each frame.
   */
  const onObjectMutate = useCallback(
    (id: string, patch: Partial<WhiteboardObject>) => onPatchStyles([{ id, patch }]),
    [onPatchStyles],
  );

  /**
   * World-space rect currently visible in the viewport. Used by the
   * connector layer for viewport culling — connectors whose AABB lies
   * entirely outside this rect get skipped, saving an SVG <path> + a
   * route computation per off-screen connector. We inflate by 30% so
   * connectors crossing the edge still render their on-screen portion
   * without flicker at the boundary.
   */
  const viewportWorld = useMemo<Rect | null>(() => {
    if (size.w === 0 || size.h === 0) return null;
    const z = camera.zoom > 0 ? camera.zoom : 1;
    const w = size.w / z;
    const h = size.h / z;
    const padX = w * 0.15;
    const padY = h * 0.15;
    return {
      x: camera.x - padX,
      y: camera.y - padY,
      w: w + padX * 2,
      h: h + padY * 2,
    };
  }, [camera.x, camera.y, camera.zoom, size.w, size.h]);

  /**
   * Memoised z-sorted view of the live object list. The previous inline
   * `objects.slice().sort(...)` reallocated and re-sorted the full array
   * on EVERY parent render — on a 1000-object board with a 60 Hz drag
   * loop that's a 1000-element O(n log n) sort 60 times per second, ~600k
   * compares/sec spent on stable order alone. Memoising on the live
   * object array reduces the work to one sort per actual mutation.
   */
  const sortedObjects = useMemo(
    () => objects.slice().sort((a, b) => a.z - b.z),
    [objects],
  );
  // R9: hoist `.includes` → `Set.has`. The render loop walks N=1000
  // objects per render; without the Set, each check is O(M selection)
  // and tagFilter check is O(K tagFilter), making the loop O(N×(M+K))
  // per render — sluggish at any realistic load.
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const tagFilterSet = useMemo(() => new Set(tagFilter), [tagFilter]);
  /**
   * R11-fix: viewport-cull the rendered object list. Previously the
   * ObjectRenderer JSX iterated every object on the board regardless
   * of camera position; a 5000-object board mounted 5000 DOM nodes
   * even when the user was zoomed-in on 20. ConnectorLayer already
   * culls; this brings ObjectRenderer to parity.
   *
   * Always include selected objects + the object being edited even
   * if they're outside the viewport — keyboard-driven nudges and
   * peer-sourced selection box should remain renderable. Frames /
   * kanbans that span the viewport are kept by their AABB test.
   */
  const visibleObjects = useMemo(() => {
    if (!viewportWorld) return sortedObjects;
    const vw = viewportWorld;
    return sortedObjects.filter((o) => {
      if (selectionSet.has(o.id)) return true;
      if (editingObjectId === o.id) return true;
      // AABB intersection vs viewport.
      const right = o.x + o.w;
      const bottom = o.y + o.h;
      if (right < vw.x) return false;
      if (bottom < vw.y) return false;
      if (o.x > vw.x + vw.w) return false;
      if (o.y > vw.y + vw.h) return false;
      return true;
    });
  }, [sortedObjects, viewportWorld, selectionSet, editingObjectId]);

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
      // R9: WCAG 2.1.1 — viewport is now keyboard-focusable. Without this
      // a keyboard-only user could not access ANY canvas shortcut
      // (N for sticky, T for text, R for rect, etc.). role="application"
      // tells SR users that arrow-key + letter shortcuts are app-mode,
      // not document-navigation.
      role="application"
      aria-label="Whiteboard canvas. Press ? for keyboard shortcuts."
      tabIndex={0}
      // R11-fix: replace `focus:outline-none` with an explicit
      // `focus-visible` inset ring. The canvas viewport is the single
      // most important focus target (role="application" + every
      // keyboard shortcut routes through it); without a visible focus
      // ring, keyboard-only users couldn't tell when focus had landed
      // here vs nested element vs lost (WCAG 2.4.7).
      className="relative h-full w-full overflow-hidden bg-bg select-none touch-none focus:outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:[outline-offset:-2px]"
      // R8: wheel handler is attached natively via useEffect (passive:false)
      // so we can call preventDefault. React's synthetic onWheel is passive.
      onWheel={onWheel}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={onCanvasPointerUp}
      onDragOver={(e) => {
        // Let the browser know we accept the drop — without this the
        // default behaviour is to reject and the onDrop never fires.
        // We accept any "Files" payload here; the drop handler
        // discriminates by MIME (image/* vs application/pdf) and
        // silently ignores everything else.
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        // ReadOnly tier: viewer / commenter cannot drop PDFs or images.
        if (readOnly) return;
        // Multi-format drop: a user may drop a PDF alongside loose
        // images. Run BOTH importers so neither silently drops files.
        // Previously the PDF path early-returned and the co-dropped
        // images vanished.
        const pdfs = extractPdfFiles(e.dataTransfer.items, e.dataTransfer.files);
        const files = extractImageFiles(e.dataTransfer.items, e.dataTransfer.files);
        if (pdfs.length === 0 && files.length === 0) return;
        e.preventDefault();
        const world = clientToWorld(e.clientX, e.clientY);
        if (pdfs.length > 0) {
          void importPdfAt(pdfs, world);
        }
        if (files.length > 0) {
          void importImagesAt(files, world);
        }
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
            viewportWorld={viewportWorld}
          />
          {/* R9: hoist Set lookups out of the map. Previously each of
              N=1000 objects ran `selection.includes(o.id)` (O(M selection))
              AND `tagFilter.includes(t)` per tag — 1000 × 10 = 10k ops
              per render just for the filter check. Sets get .has() to O(1). */}
          {(() => null)()}
          {visibleObjects.map((o) => {
            // Tag-filter dimming (Phase 26). When the user has at
            // least one tag in the filter set, any object that
            // doesn't carry one of those tags is rendered at 25%
            // opacity. Pointer events stay enabled so users can
            // still click through and clear the filter if they need
            // to grab a dimmed object — Miro's behaviour. When NO
            // tag filter is active (the common case), we skip the
            // wrapping <div> entirely — saving 1000 extra DOM nodes
            // on a 1000-object board.
            if (tagFilter.length === 0) {
              return (
                <ObjectRenderer
                  key={o.id}
                  object={o}
                  selected={selectionSet.has(o.id)}
                  editing={editingObjectId === o.id}
                  onPointerDown={onObjectPointerDown}
                  onDoubleClick={onObjectDoubleClick}
                  onCommitEdit={onCommitObjectEdit}
                  onMutate={onObjectMutate}
                  selfId={self.id}
                />
              );
            }
            const dimmed = !(o.tags ?? []).some((t) => tagFilterSet.has(t));
            return (
              <div
                key={o.id}
                style={dimmed ? DIMMED_WRAPPER_STYLE : undefined}
              >
                <ObjectRenderer
                  object={o}
                  selected={selectionSet.has(o.id)}
                  editing={editingObjectId === o.id}
                  onPointerDown={onObjectPointerDown}
                  onDoubleClick={onObjectDoubleClick}
                  onCommitEdit={onCommitObjectEdit}
                  onMutate={onObjectMutate}
                  selfId={self.id}
                />
              </div>
            );
          })}
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
          onOpenCardDetail={setCardDetailId}
        />
      )}

      {/* Marquee — only renders while a marquee drag is in progress. */}
      {marquee && <Marquee marquee={marquee} camera={camera} />}

      {/* Alignment guides — only while a drag is producing snaps.
          Subscription to `dragGuides` lives INSIDE the wrapper
          component so the parent doesn't re-render on every guide
          update (the drag loop sets guides at ~60 Hz). The wrapper
          memos away no-op renders so the SVG only paints when the
          guides actually change shape. */}
      <DragGuidesLayer camera={camera} />

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
      {chatComposerScreen && viewportRectRef.current && (
        <ChatComposer
          screen={chatComposerScreen}
          // Read the cached viewport rect rather than re-invoking
          // `getBoundingClientRect()` in render — the latter forces a
          // synchronous layout flush every time the parent re-renders
          // (which during a drag is ~60 Hz). The cached rect is
          // refreshed on ResizeObserver + window scroll, so it stays
          // accurate without the layout cost.
          viewportRect={viewportRectRef.current}
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
          {/* Bring everyone to me / Spotlight buttons — only meaningful
              when there are peers to bring. The local camera's world
              rect is used as the focus payload. */}
          <button
            type="button"
            onClick={() => {
              if (size.w === 0) return;
              broadcastFocus("snap", {
                x: camera.x, y: camera.y,
                w: size.w / Math.max(0.001, camera.zoom),
                h: size.h / Math.max(0.001, camera.zoom),
              });
              logActivity("focus", "Brought peers to my view");
            }}
            aria-label="Bring everyone to my view"
            title="Bring everyone to me"
            className="ml-1 text-[10px] uppercase font-mono text-sub hover:text-text px-2 py-1 rounded bg-surface/95 border border-border"
          >
            Bring all
          </button>
          {/* Spotlight: highlight the current selection bbox (or the
              full viewport if nothing is selected) on peers' screens. */}
          <button
            type="button"
            onClick={() => {
              const target = selectionBbox ?? {
                x: camera.x, y: camera.y,
                w: size.w / Math.max(0.001, camera.zoom),
                h: size.h / Math.max(0.001, camera.zoom),
              };
              broadcastFocus("spotlight", target);
              logActivity("spotlight", selectionBbox
                ? `Spotlighted ${selection.length} object${selection.length === 1 ? "" : "s"}`
                : "Spotlighted my view");
            }}
            aria-label="Spotlight"
            title="Spotlight (8s flash on peer screens)"
            className="ml-1 text-[10px] uppercase font-mono text-sub hover:text-text px-2 py-1 rounded bg-surface/95 border border-border"
          >
            Spotlight
          </button>
        </div>
      )}

      {/* Incoming spotlight from a peer: render a dimmed surround with
          a cutout over the spotlighted world rect. Camera stays put;
          local user keeps their own view but knows where to look. */}
      {spotlightRect && size.w > 0 && (() => {
        const sx = (spotlightRect.x - camera.x) * camera.zoom;
        const sy = (spotlightRect.y - camera.y) * camera.zoom;
        const sw = spotlightRect.w * camera.zoom;
        const sh = spotlightRect.h * camera.zoom;
        return (
          <div
            aria-hidden="true"
            data-canvas-export-ignore="true"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 9993,
              // 4 dimming rectangles forming a cutout around the
              // spotlighted area. Simpler than CSS clip-path on
              // older browsers and avoids the radial-gradient
              // "fade" that doesn't read as "look exactly here".
              background: `
                linear-gradient(to bottom, rgba(0,0,0,0.55) ${sy}px, transparent ${sy}px, transparent ${sy + sh}px, rgba(0,0,0,0.55) ${sy + sh}px),
                linear-gradient(to right, rgba(0,0,0,0.55) ${sx}px, transparent ${sx}px, transparent ${sx + sw}px, rgba(0,0,0,0.55) ${sx + sw}px)
              `,
              backgroundBlendMode: "lighten",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: sx - 2,
                top: sy - 2,
                width: sw + 4,
                height: sh + 4,
                border: "2px solid #00f0ff",
                boxShadow: "0 0 24px rgba(0,240,255,0.7)",
                borderRadius: 6,
              }}
            />
          </div>
        );
      })()}

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

      {/* Card detail modal — full edit form for the selected card.
       * Triggered by Cmd+E or the "Details" pill on the property panel.
       * Phase 26 — closes the shipped-but-shallow gap where cards only
       * supported inline title editing. */}
      {cardDetailId && (() => {
        const o = objectsById.get(cardDetailId);
        if (!o || o.type !== "card") return null;
        return (
          <CardDetailModal
            // `key` forces React to remount the modal whenever the focused
            // card changes, so its useState form fields re-initialise from
            // the new `card` prop. Without this a Cmd+E swap between cards
            // would keep the previous card's in-progress form state.
            key={cardDetailId}
            card={o as WhiteboardCard}
            onPatch={(id, patch) => onPatchStyles([{ id, patch }])}
            onClose={() => setCardDetailId(null)}
          />
        );
      })()}

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

      {/* Empty-state hint — the centred CTA card lives in canvas-client.tsx
          ("Start your board" with Templates / Import buttons). Rendering
          a second centred hint here too caused fragments of THIS one to
          peek out from behind the CTA card. The pan/zoom navigation
          hint moved to the bottom edge so it doesn't visually conflict
          and stays useful as soon as the user dismisses the CTA (e.g.
          by clicking a tool). */}
      {objects.length === 0 && (
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none text-[10px] text-sub/70 font-mono text-center"
          data-canvas-export-ignore="true"
        >
          Hold <kbd className="px-1 bg-surface/70 border border-border rounded text-[10px]">Space</kbd> + drag to pan · scroll to zoom
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

/* ─── Alignment guides layer ─────────────────────────────────────────── */

// Owns its own `dragGuides` subscription so the parent
// WhiteboardCanvas doesn't re-render on every guide update during a
// drag (~60 Hz). Only the SVG re-renders. Memoised on `camera` so a
// parent re-render that didn't change the camera doesn't paint this
// either.
const DragGuidesLayer = memo(function DragGuidesLayerImpl({ camera }: { camera: { x: number; y: number; zoom: number } }) {
  const dragGuides = useCanvasStore((s) => s.dragGuides);
  if (dragGuides.length === 0) return null;
  return <AlignmentGuides guides={dragGuides} camera={camera} />;
});
