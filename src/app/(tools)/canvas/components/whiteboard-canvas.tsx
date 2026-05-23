"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { rafThrottle } from "@/lib/utils/throttle";
import { rectUnion } from "@/lib/geometry/bbox";
import type { Rect } from "@/lib/geometry/bbox";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { wbId } from "@/lib/whiteboard/clipboard";
import { STICKY_DEFAULT } from "../constants";
import { layoutMindMap, MIND_MAP_NODE_DEFAULT } from "@/lib/whiteboard/mind-map-layout";
import type { WhiteboardMindMapNode } from "@/lib/stores/workspace-types";
import type { MindMapTreeNode } from "./ai-mind-map-section";
import { useCanvasUndoStack } from "../use-undo-stack";
import { useCanvasStore } from "../use-canvas-store";
import { Marquee } from "./marquee";
import { SelectionHandles } from "./selection-handles";
import { AlignToolbar } from "./align-toolbar";
import { PropertyPanel } from "./property-panel";
import { PresentationMode } from "./presentation-mode";
import { extractImageFiles } from "@/lib/whiteboard/image-import";
import { extractPdfFiles } from "@/lib/whiteboard/pdf-import";
import { ChatComposer } from "./chat-composer";
import { AlignmentGuides } from "./alignment-guides";
import { ClusterOverlay } from "./cluster-overlay";
import { CommentPins } from "./comment-pins";
import { clusterObjects } from "@/lib/whiteboard/cluster-bridge";
import { boardInsights } from "@/lib/analytics/board-insights";
import { useCanvasRoom } from "@/lib/whiteboard/use-canvas-room";
import { useCanvasPresence } from "@/lib/whiteboard/use-canvas-presence";
import { CursorOverlay } from "./cursor-overlay";
import { PresenceChips, SpotlightCutout, ConnectorBanner, EmptyCanvasHint } from "./canvas-overlays";
import { CanvasWorldLayer } from "./canvas-world-layer";
import { CanvasModals } from "./canvas-modals";
import { useRemoteFocusReceiver } from "../hooks/use-remote-focus-receiver";
import { useViewportSize } from "../hooks/use-viewport-size";
import { useFollowMode } from "../hooks/use-follow-mode";
import { usePresentationMode } from "../hooks/use-presentation-mode";
import { useTabNavigation } from "../hooks/use-tab-navigation";
import { useArrowKeyNudge } from "../hooks/use-arrow-key-nudge";
import { useCursorChatAndReactions } from "../hooks/use-cursor-chat-and-reactions";
import { useFrameBookmarkShortcut, useEnterEditShortcut, useCardDetailShortcut } from "../hooks/use-contextual-shortcuts";
import { useSpaceHoldPan, useWheelZoom } from "../hooks/use-pan-zoom-controls";
import { useCanvasShortcuts } from "../hooks/use-canvas-shortcuts";
import { useAlignDistribute } from "../hooks/use-align-distribute";
import { useCanvasImports } from "../hooks/use-canvas-imports";
import { useAddObjectAt } from "../hooks/use-add-object-at";
import { useCanvasPointerMachine } from "../hooks/use-canvas-pointer-machine";
import { useObjectInteractions } from "../hooks/use-object-interactions";
import { useMindMapStructural } from "../hooks/use-mind-map-structural";

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
  // Viewport DOM ref + cached DOMRect + size live in their own hook so
  // the ResizeObserver + scroll listener stays out of this file.
  const { viewportRef, viewportRectRef, size } = useViewportSize(onViewportSize);
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
  // O(local-density). Owned by the pointer-machine hook; exposed
  // back here so onObjectPointerDown can populate it at drag start.
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
  // Board-change cleanup for parent-owned UI state. The pointer state
  // machine owns its own cleanup for the gesture refs (lasso, pan
  // latch, drag-create origin, snap index) and the in-flight gesture
  // store entries (drag / resize / rotation / marquee / drawing /
  // pendingConnector / dragGuides / editing). What's left here is
  // local UI state and the spaceHeld / remote-focus latches that
  // live outside the pointer machine.
  useEffect(() => {
    return () => {
      setChatComposerScreen(null);
      spaceHeldRef.current = false;
      setPreviewCursor(null);
      setCardDetailId(null);
      setActiveCommentThreadId(null);
    };
  }, [boardId]);

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
  // Receive bring-everyone / spotlight broadcasts (Phase 27/29).
  // For "snap" we fit-to-rect the local camera; for "spotlight" the
  // hook returns the rect and we render <SpotlightCutout> below.
  const spotlightRect = useRemoteFocusReceiver({ remoteFocus, size, setCamera });
  const spaceHeldRef = useRef(false);
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

  usePresentationMode({
    presentationFrameIndex,
    orderedFrames,
    size,
    setCamera,
    setPresentationFrameIndex,
  });

  useFollowMode(followUserId, members, setCamera);

  useSpaceHoldPan(spaceHeldRef);

  // rAF-throttled setCamera so wheel + pan don't thrash React.
  const throttledSetCamera = useRef(rafThrottle(setCamera)).current;
  // Cancel any in-flight rAF on unmount — otherwise a pending camera
  // update can fire after the component has unmounted and call
  // setCamera on a stale store reference. `rafThrottle` exposes a
  // `.cancel()` method that drops the pending frame.
  useEffect(() => () => throttledSetCamera.cancel?.(), [throttledSetCamera]);

  useTabNavigation({ objects, selection, size, camera, setSelection, setCamera });

  const toggleFrameBookmark = useCanvasStore((s) => s.toggleFrameBookmark);
  useFrameBookmarkShortcut({ selection, objectsById, boardId, toggleFrameBookmark, logActivity, readOnly });
  useEnterEditShortcut({ selection, objectsById, editingObjectId, setEditingObjectId, readOnly });
  useCardDetailShortcut({ selection, objectsById, cardDetailId, setCardDetailId, readOnly });

  useArrowKeyNudge({ selection, objectsById, upsertMany, readOnly, presentationFrameIndex });

  // Empty React onWheel handler — the real wheel listener is attached
  // natively in `useWheelZoom` because React's synthetic wheel is
  // passive (can't preventDefault). The JSX still binds this prop so
  // React doesn't strip the data-canvas attribute lookup.
  const onWheel = useCallback(() => { /* handled natively in useWheelZoom */ }, []);
  useWheelZoom({ viewportRef, viewportRectRef, camera, throttledSetCamera, presentationFrameIndex });

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
    // viewportRectRef returned by useViewportSize is identity-stable;
    // include it in deps to keep react-hooks/exhaustive-deps happy.
    [camera, viewportRectRef],
  );

  /** AI-brainstorm landing: when the brainstorm action produces N
   * sticky texts, drop them as a grid of stickies near the camera
   * centre. Snapshots once for the whole batch so a single Cmd+Z
   * removes all of them. */
  const onApplyAiStickies = useCallback(
    (texts: readonly string[]) => {
      if (readOnly || texts.length === 0) return;
      const now = new Date().toISOString();
      const z = (topZRef.current ?? 0) + 1;
      // Grid layout: aim for a roughly square arrangement, max 5
      // columns so very long lists still fit a typical viewport.
      const cols = Math.min(5, Math.ceil(Math.sqrt(texts.length)));
      const gap = 24;
      const cellW = STICKY_DEFAULT.w + gap;
      const cellH = STICKY_DEFAULT.h + gap;
      // Centre the grid on the viewport's world centre.
      const viewW = size.w / Math.max(0.001, camera.zoom);
      const viewH = size.h / Math.max(0.001, camera.zoom);
      const centreX = camera.x + viewW / 2;
      const centreY = camera.y + viewH / 2;
      const rows = Math.ceil(texts.length / cols);
      const startX = centreX - (cols * cellW) / 2 + gap / 2;
      const startY = centreY - (rows * cellH) / 2 + gap / 2;
      const stickies: WhiteboardObject[] = texts.map((text, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return {
          id: wbId("wb"),
          boardId,
          type: "sticky",
          x: startX + col * cellW,
          y: startY + row * cellH,
          w: STICKY_DEFAULT.w,
          h: STICKY_DEFAULT.h,
          z: z + i,
          version: 1,
          createdAt: now,
          updatedAt: now,
          content: text,
          color: stickyColor,
        };
      });
      pushSnapshot();
      upsertMany(stickies);
      setSelection(stickies.map((s) => s.id));
      logActivity("added", `Brainstormed ${stickies.length} sticky${stickies.length === 1 ? "" : "s"} via AI`);
    },
    [readOnly, topZRef, size.w, size.h, camera.x, camera.y, camera.zoom, boardId, stickyColor, pushSnapshot, upsertMany, setSelection, logActivity],
  );

  /**
   * AI text-update landing (translate / rewrite).
   *
   * The LLM returns `{ id: "new text" }`. For each id we look up the
   * object, decide which text field is its primary content (sticky /
   * text / shape → content; frame / kanban / timer → label; card →
   * title; voting → question), and patch ONLY that field. Other
   * fields untouched. Single snapshot for the whole batch so undo
   * removes the entire translate / rewrite in one Cmd+Z.
   */
  const onApplyTextUpdates = useCallback(
    (updates: Record<string, string>) => {
      if (readOnly) return;
      const fieldByType: Record<string, "content" | "label" | "title" | "question" | "text"> = {
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
        mindMapNode: "text",
        diagramShape: "label",
      };
      const now = new Date().toISOString();
      const patched: WhiteboardObject[] = [];
      for (const [id, text] of Object.entries(updates)) {
        const obj = objectsById.get(id);
        if (!obj || obj.locked) continue;
        const field = fieldByType[obj.type];
        if (!field) continue;
        patched.push({
          ...obj,
          [field]: text,
          version: obj.version + 1,
          updatedAt: now,
        } as WhiteboardObject);
      }
      if (patched.length === 0) return;
      pushSnapshot();
      upsertMany(patched);
      logActivity("edited", `AI-updated ${patched.length} object${patched.length === 1 ? "" : "s"}`);
    },
    [readOnly, objectsById, pushSnapshot, upsertMany, logActivity],
  );

  /**
   * AI extract-action-items landing: drop a column of card objects
   * for each action item. Cards land to the RIGHT of the selection
   * bbox (or right of the viewport centre when selection is empty)
   * so they sit next to the source material without overlapping it.
   * The owner name lands in `card.assignee`; targetTool is captured
   * in card.sourceRef so a future "push to backlog" flow can use it.
   */
  const onApplyActionItems = useCallback(
    (items: readonly { title: string; ownerId?: string; ownerName?: string; targetTool?: string }[]) => {
      if (readOnly || items.length === 0) return;
      const now = new Date().toISOString();
      const z = (topZRef.current ?? 0) + 1;
      const cardW = 240;
      const cardH = 110;
      const gap = 16;
      // Anchor: right edge of selection bbox + small gap; fall back
      // to right edge of viewport when no selection.
      let originX: number;
      let originY: number;
      if (selectionBbox) {
        originX = selectionBbox.x + selectionBbox.w + gap;
        originY = selectionBbox.y;
      } else {
        const viewW = size.w / Math.max(0.001, camera.zoom);
        const viewH = size.h / Math.max(0.001, camera.zoom);
        originX = camera.x + viewW * 0.7;
        originY = camera.y + viewH * 0.2;
      }
      const cards: WhiteboardObject[] = items.map((item, i) => ({
        id: wbId("wb"),
        boardId,
        type: "card",
        x: originX,
        y: originY + i * (cardH + gap),
        w: cardW,
        h: cardH,
        z: z + i,
        version: 1,
        createdAt: now,
        updatedAt: now,
        title: item.title,
        assignee: item.ownerName,
        color: "#00f0ff",
        sourceRef: item.targetTool && item.targetTool !== "none"
          ? { tool: item.targetTool, entityId: item.ownerId ?? "" }
          : undefined,
      } as WhiteboardObject));
      pushSnapshot();
      upsertMany(cards);
      setSelection(cards.map((c) => c.id));
      logActivity("added", `AI-extracted ${cards.length} action item${cards.length === 1 ? "" : "s"}`);
    },
    [readOnly, topZRef, selectionBbox, size.w, size.h, camera.x, camera.y, camera.zoom, boardId, pushSnapshot, upsertMany, setSelection, logActivity],
  );

  /**
   * AI mind-map landing: walk the tree, build a flat list of
   * mindMapNode objects with parent/child via DFS, then run the
   * standard right-radiating layout to position everything.
   *
   * Drops at viewport centre. All nodes share a single mindMapId so
   * the layout treats them as one map and edges render between them.
   */
  const onApplyMindMapTree = useCallback(
    (root: MindMapTreeNode) => {
      if (readOnly) return;
      const now = new Date().toISOString();
      const zBase = (topZRef.current ?? 0) + 1;
      // Root id doubles as the mindMapId so the whole tree shares
      // a single identifier from creation onward.
      const rootId = wbId("wb");
      const created: WhiteboardMindMapNode[] = [];
      const dfs = (n: MindMapTreeNode, parentId: string | undefined): string => {
        const id = parentId === undefined ? rootId : wbId("wb");
        const node: WhiteboardMindMapNode = {
          id,
          boardId,
          type: "mindMapNode",
          // Temp position — layout overwrites x/y for every node
          // below. We seed with viewport centre so the layout sees a
          // sensible starting point for the root.
          x: 0,
          y: 0,
          w: MIND_MAP_NODE_DEFAULT.w,
          h: MIND_MAP_NODE_DEFAULT.h,
          z: zBase + created.length,
          version: 1,
          createdAt: now,
          updatedAt: now,
          text: n.label,
          parentNodeId: parentId,
          mindMapId: rootId,
        };
        created.push(node);
        for (const child of n.children) dfs(child, id);
        return id;
      };
      dfs(root, undefined);
      if (created.length === 0) return;
      // Anchor the root at the viewport centre so the user lands on
      // it without having to pan.
      const viewW = size.w / Math.max(0.001, camera.zoom);
      const viewH = size.h / Math.max(0.001, camera.zoom);
      const centreX = camera.x + viewW / 2 - MIND_MAP_NODE_DEFAULT.w / 2;
      const centreY = camera.y + viewH / 2 - MIND_MAP_NODE_DEFAULT.h / 2;
      const positions = layoutMindMap(created, { x: centreX, y: centreY });
      const positioned: WhiteboardMindMapNode[] = created.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, x: p.x, y: p.y } : n;
      });
      pushSnapshot();
      upsertMany(positioned);
      setSelection([rootId]);
      logActivity("added", `AI-generated mind map with ${positioned.length} nodes`);
    },
    [readOnly, topZRef, boardId, size.w, size.h, camera.x, camera.y, camera.zoom, pushSnapshot, upsertMany, setSelection, logActivity],
  );

  /**
   * AI cluster summarization landing: drop a single summary sticky at
   * the cluster's bbox centre. Sized larger than a regular sticky
   * (1.25×) and tinted by the active sticky colour so it reads as the
   * "headline" of the cluster.
   */
  const onApplyClusterSummary = useCallback(
    (cluster: { bbox: { x: number; y: number; w: number; h: number } }, text: string) => {
      if (readOnly || !text) return;
      const now = new Date().toISOString();
      const z = (topZRef.current ?? 0) + 1;
      const w = Math.round(STICKY_DEFAULT.w * 1.25);
      const h = Math.round(STICKY_DEFAULT.h * 1.25);
      // Centre on the cluster bbox so it visually labels the group.
      const cx = cluster.bbox.x + cluster.bbox.w / 2;
      const cy = cluster.bbox.y + cluster.bbox.h / 2;
      const sticky: WhiteboardObject = {
        id: wbId("wb"),
        boardId,
        type: "sticky",
        x: cx - w / 2,
        y: cy - h / 2,
        w,
        h,
        z,
        version: 1,
        createdAt: now,
        updatedAt: now,
        content: text,
        color: stickyColor,
      };
      pushSnapshot();
      upsertMany([sticky]);
      setSelection([sticky.id]);
      logActivity("added", `Summarised cluster into a sticky`);
    },
    [readOnly, topZRef, boardId, stickyColor, pushSnapshot, upsertMany, setSelection, logActivity],
  );

  const pickedDiagramShape = useCanvasStore((s) => s.pickedDiagramShape);
  const addObjectAt = useAddObjectAt({
    boardId, stickyColor, tool, topZRef, pickedDiagramShape,
    upsert, setTool, setSelection, setEditingObjectId, logActivity,
  });

  // The canvas pointer state machine owns the three viewport pointer
  // handlers + every ref they share (pan latches, lasso fast-path,
  // drag-create origin, snap index). Returns the refs that the
  // object-level handlers and cursor-chat hook still need to read.
  const {
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    dragSnapIndexRef,
    lastPointerRef,
    lassoRafRef,
    lassoPointsRef,
    lastLassoWorldRef,
  } = useCanvasPointerMachine({
    boardId, readOnly, canComment,
    camera, tool, stickyColor, snapToGridEnabled, snapToObjectsEnabled,
    pendingConnectorFromId,
    drag, resize, rotation, marquee, drawing,
    setMarquee, setDrawing, setDrag, setResize, setRotation,
    setPendingConnectorFromId, setDragGuides, setEditingObjectId, setTool,
    selection, setSelection, clearSelection,
    objects, objectsById, upsert, upsertMany, upsertCommentThread,
    viewportRef, viewportRectRef, spaceHeldRef, topZRef, dragGuidesRef,
    throttledSetCamera, clientToWorld,
    publish, setPreviewCursor, setActiveCommentThreadId,
    addObjectAt,
    pushSnapshot, log, logActivity,
  });

  useCursorChatAndReactions({
    chatComposerScreen,
    setChatComposerScreen,
    lastPointerRef,
    publish,
    clientToWorld,
  });

  // Keyboard shortcuts wired AFTER the pointer machine so the Esc-cancel
  // path can tear down an in-flight lasso via the refs the machine
  // owns. The shortcuts also reference the same drag/resize/etc.
  // ephemeral state so they can self-suppress mid-gesture.
  useCanvasShortcuts({
    objectsRef, objectsByIdRef, topZRef,
    lassoRafRef, lassoPointsRef, lastLassoWorldRef,
    drag, resize, rotation, marquee, drawing, pendingConnectorFromId,
    selection, setSelection, clearSelection,
    setDrag, setResize, setRotation, setMarquee, setDrawing, setPendingConnectorFromId,
    setTool,
    boardId, removeMany, upsertMany,
    pushSnapshot, undo, redo,
    log, logActivity,
    readOnly,
  });


  const { onAlign, onDistribute } = useAlignDistribute({
    selection,
    objectsById,
    upsertMany,
    pushSnapshot,
    log,
  });

  const { importImagesAt, importPdfAt } = useCanvasImports({
    boardId, objects, upsertMany, setSelection,
    pushSnapshot, log, logActivity, readOnly,
    editingObjectId, chatComposerScreen,
    clientToWorld, viewportRectRef,
  });

  const {
    onObjectPointerDown,
    onObjectDoubleClick,
    onCommitObjectEdit,
    onPatchStyles,
    onObjectMutate,
    onConnectorPointerDown,
    onResizeHandlePointerDown,
    onRotateByDelta,
    onRotateStart,
  } = useObjectInteractions({
    boardId, objects, objectsById, upsert, upsertMany,
    tool, setTool, selection, setSelection, toggleSelection,
    pendingConnectorFromId, setPendingConnectorFromId,
    setDrag, setMarquee, setResize, setRotation, setEditingObjectId,
    viewportRef, dragSnapIndexRef, topZRef,
    clientToWorld,
    pushSnapshot, log, logActivity,
    readOnly,
  });

  // Mind-map Tab/Enter/Shift+Tab routing — wired through every
  // mind-map node's inline editor. Owns layout + selection +
  // edit-mode transitions for the new child/sibling.
  const onMindMapStructural = useMindMapStructural({
    boardId,
    objects,
    objectsById,
    upsertMany,
    setSelection,
    setEditingObjectId,
    pushSnapshot,
    topZRef,
    readOnly,
  });

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

      <CanvasWorldLayer
        camera={camera}
        objects={objects}
        visibleObjects={visibleObjects}
        selection={selection}
        selectionSet={selectionSet}
        pendingConnectorFromId={pendingConnectorFromId}
        previewCursor={previewCursor}
        viewportWorld={viewportWorld}
        drawing={drawing}
        editingObjectId={editingObjectId}
        tagFilter={tagFilter}
        tagFilterSet={tagFilterSet}
        selfId={self.id}
        onConnectorPointerDown={onConnectorPointerDown}
        onObjectPointerDown={onObjectPointerDown}
        onObjectDoubleClick={onObjectDoubleClick}
        onCommitObjectEdit={onCommitObjectEdit}
        onObjectMutate={onObjectMutate}
        onMindMapStructural={onMindMapStructural}
      />

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

      <PresenceChips
        members={members}
        selfId={self.id}
        followUserId={followUserId}
        setFollowUserId={setFollowUserId}
        camera={camera}
        size={size}
        broadcastFocus={broadcastFocus}
        selectionBbox={selectionBbox}
        selection={selection}
        logActivity={logActivity}
      />

      {spotlightRect && (
        <SpotlightCutout rect={spotlightRect} camera={camera} size={size} />
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

      <CanvasModals
        showMiniMap={showMiniMap}
        objects={objects}
        camera={camera}
        size={size}
        setCamera={setCamera}
        boardId={boardId}
        showAIPanel={showAIPanel}
        clusters={clusters}
        insights={insights}
        setSelection={setSelection}
        setShowAIPanel={setShowAIPanel}
        selection={selection}
        onApplyAiStickies={onApplyAiStickies}
        onApplyClusterSummary={onApplyClusterSummary}
        onApplyTextUpdates={onApplyTextUpdates}
        onApplyActionItems={onApplyActionItems}
        onApplyMindMapTree={onApplyMindMapTree}
        activeCommentThread={activeCommentThread}
        setActiveCommentThreadId={setActiveCommentThreadId}
        cardDetailId={cardDetailId}
        setCardDetailId={setCardDetailId}
        objectsById={objectsById}
        onPatchStyles={onPatchStyles}
      />

      <ConnectorBanner tool={tool} pendingConnectorFromId={pendingConnectorFromId} />

      <EmptyCanvasHint objectCount={objects.length} />
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
