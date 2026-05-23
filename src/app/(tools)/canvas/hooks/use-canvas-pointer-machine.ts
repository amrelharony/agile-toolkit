"use client";

import { useCallback, useEffect, useRef, type RefObject, type MutableRefObject } from "react";
import { panBy } from "@/lib/whiteboard/canvas-transform";
import { aabbIntersect, boundingBoxOfFlatPoints, rectFromCorners, rectOverlapsPolygon } from "@/lib/geometry/bbox";
import type { Camera } from "@/lib/geometry/bbox";
import { snapToGrid as snapToGridFn, snapToObjects as snapToObjectsFn, DEFAULT_GRID_SIZE, DEFAULT_GUIDE_TOLERANCE, type SpatialIndex, type AlignmentGuide } from "@/lib/whiteboard/snap";
import { layoutMindMap, isMindMapDescendant } from "@/lib/whiteboard/mind-map-layout";
import type { WhiteboardMindMapNode } from "@/lib/stores/workspace-types";
import { wbId } from "@/lib/whiteboard/clipboard";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useCanvasStore } from "../use-canvas-store";
import { STICKY_DEFAULT, SHAPE_DEFAULT, TEXT_DEFAULT } from "../constants";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import type { CanvasTool } from "../use-canvas-store";

type LogFn = ReturnType<typeof useHistoryLogger>["log"];

// Read-only state shapes — the hook reads ephemeral state but never
// constructs it (set by other code paths via the canvas store).
type DragState = { startWorld: { x: number; y: number }; initialRects: Record<string, { x: number; y: number; w: number; h: number }> };
type ResizeState = {
  handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
  startWorld: { x: number; y: number };
  initialRect: { x: number; y: number; w: number; h: number };
  objectId: string;
  initialRects?: Record<string, { x: number; y: number; w: number; h: number }>;
  initialUnion?: { x: number; y: number; w: number; h: number };
};
type RotationState = {
  centerWorld: { x: number; y: number };
  startAngleDeg: number;
  initialRotations: Record<string, number>;
};
type MarqueeState = {
  startWorld: { x: number; y: number };
  currentWorld: { x: number; y: number };
  initialSelection: string[];
  additive: boolean;
  lassoPoints?: number[];
};

/**
 * Refs returned by `useCanvasPointerMachine` that cross-cut into
 * external gesture initiators (object click, resize/rotate handle
 * pointer-down). The pointer-machine OWNS these refs but exposes
 * them so the object-level handlers can collaborate without
 * duplicating ref state.
 */
export type PointerMachineRefs = {
  // Snap index built at drag-start by the object-pointer-down
  // handler; cleared in pointer-up.
  dragSnapIndexRef: MutableRefObject<SpatialIndex | null>;
  // Last screen-space pointer position — read by the cursor-chat hook
  // (`/` opens composer at cursor) and the emoji-reaction hook (1-6
  // spawn at cursor). Written every pointermove.
  lastPointerRef: RefObject<{ x: number; y: number } | null>;
  // True while a pan gesture is active (middle-mouse, hand tool,
  // space-hold + drag). Reads aren't needed elsewhere yet but the ref
  // is exposed for consistency.
  isPanningRef: MutableRefObject<boolean>;
  // Lasso fast-path refs — exposed so the Esc-cancel shortcut and
  // the visibility-change cleanup can tear down an in-flight lasso
  // without going through the pointer-move handler.
  lassoRafRef: MutableRefObject<number | null>;
  lassoPointsRef: MutableRefObject<number[] | null>;
  lastLassoWorldRef: MutableRefObject<{ x: number; y: number } | null>;
};

/**
 * The canvas-level pointer state machine.
 *
 * Owns the three viewport pointer handlers (`onCanvasPointerDown`,
 * `onCanvasPointerMove`, `onCanvasPointerUp`) plus every ref they
 * use to coordinate gesture state across the pointer lifecycle:
 *
 *  - `isPanningRef` — pan latch (middle-mouse / hand / space-hold)
 *  - `lastPointerRef` — last client x/y for ad-hoc UI at cursor
 *  - `createStartRef` — pointer-down world coord for drag-to-create
 *  - `lassoPointsRef` / `lastLassoWorldRef` / `lassoRafRef` —
 *    rAF-batched lasso polygon append + hit-test
 *  - `dragSnapIndexRef` — pre-built snap candidate index, populated
 *    by the object-pointer-down handler in the parent and consumed
 *    in pointer-move; cleared in pointer-up. Exposed via the return
 *    value so object-level code can write to it.
 *
 * Behaviour:
 *  - Pointer-down dispatches per tool: pan → marquee/lasso →
 *    line/arrow/freehand draft → connector cancel → comment thread →
 *    drag-to-create draft → fall-through `addObjectAt` click-create.
 *  - Pointer-move continues the active gesture: pan, drawing,
 *    marquee/lasso hit-test, drag with snap-to-grid / snap-to-object,
 *    rotation (atan2 + Shift snap to 15°), resize (union-bbox scale).
 *  - Pointer-up commits or finalises the gesture, including the
 *    kanban drop-into-column snap (Phase 26) and the bidirectional
 *    card↔story status sync.
 *
 * Board-switch cleanup is owned here too — any in-flight gesture on
 * the previous board would otherwise leak into the new one (a
 * half-finished drawing commits to the wrong boardId, a pending
 * lasso rAF mutates the new board's selection, etc.).
 */
export function useCanvasPointerMachine(params: {
  // Workspace + identity
  boardId: string;
  readOnly: boolean;
  canComment: boolean;
  // Canvas-store reads
  camera: Camera;
  tool: CanvasTool;
  stickyColor: string;
  snapToGridEnabled: boolean;
  snapToObjectsEnabled: boolean;
  pendingConnectorFromId: string | null;
  drag: DragState | null;
  resize: ResizeState | null;
  rotation: RotationState | null;
  marquee: MarqueeState | null;
  drawing: WhiteboardObject | null;
  // Canvas-store writes
  setMarquee: (m: MarqueeState | null) => void;
  setDrawing: (d: WhiteboardObject | null) => void;
  setDrag: (d: DragState | null) => void;
  setResize: (r: ResizeState | null) => void;
  setRotation: (r: RotationState | null) => void;
  setPendingConnectorFromId: (id: string | null) => void;
  setDragGuides: (g: AlignmentGuide[]) => void;
  setEditingObjectId: (id: string | null) => void;
  setTool: (t: CanvasTool) => void;
  selection: readonly string[];
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  // Workspace mutators
  objects: readonly WhiteboardObject[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  upsert: (obj: WhiteboardObject) => void;
  upsertMany: (objs: WhiteboardObject[]) => void;
  upsertCommentThread: (t: { id: string; boardId: string; x: number; y: number; comments: [] }) => void;
  // Refs from parent
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportRectRef: RefObject<DOMRect | null>;
  spaceHeldRef: RefObject<boolean>;
  topZRef: RefObject<number>;
  dragGuidesRef: RefObject<readonly AlignmentGuide[]>;
  // Camera / coords
  throttledSetCamera: (cam: Camera) => void;
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  // Multiplayer + helpers
  publish: (patch: { cursor?: { x: number; y: number } }) => void;
  setPreviewCursor: (c: { x: number; y: number } | null) => void;
  setActiveCommentThreadId: (id: string | null) => void;
  addObjectAt: (worldX: number, worldY: number) => void;
  // Undo + logging
  pushSnapshot: () => void;
  log: LogFn;
  logActivity: (kind: string, summary: string) => void;
}): {
  onCanvasPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onCanvasPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onCanvasPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
} & PointerMachineRefs {
  const {
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
  } = params;

  // Pan latches
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // Drag-to-create origin: pointer-down world point so the move
  // handler can re-derive the rect even when the user drags up/left
  // and the rect flips around the origin.
  const createStartRef = useRef<{ x: number; y: number } | null>(null);
  // Snap candidate index built at drag-start.
  const dragSnapIndexRef = useRef<SpatialIndex | null>(null);
  // Lasso fast-path: per-pointer-move append into a ref (no re-render),
  // rAF coalesces visual update + hit-test to ≤60 Hz.
  const lassoPointsRef = useRef<number[] | null>(null);
  const lassoRafRef = useRef<number | null>(null);
  const lastLassoWorldRef = useRef<{ x: number; y: number } | null>(null);

  // Board-switch cleanup. Any in-flight gesture on the previous board
  // would otherwise leak into the new one.
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
      if (lassoRafRef.current != null) {
        cancelAnimationFrame(lassoRafRef.current);
        lassoRafRef.current = null;
      }
      lassoPointsRef.current = null;
      lastLassoWorldRef.current = null;
      isPanningRef.current = false;
      createStartRef.current = null;
      dragSnapIndexRef.current = null;
      lastPointerRef.current = null;
    };
  }, [boardId, setDrag, setResize, setRotation, setMarquee, setDrawing, setPendingConnectorFromId, setDragGuides, setEditingObjectId]);

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
      if ((dragGuidesRef.current?.length ?? 0) > 0) setDragGuides([]);
      // Defensive: reset spaceHeld too — if the user held Space then
      // Cmd-Tabbed, the keyup fires on the other app and our latch
      // would stay true forever.
      (spaceHeldRef as MutableRefObject<boolean>).current = false;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [drag, resize, rotation, marquee, drawing, setDrag, setResize, setRotation, setMarquee, setDrawing, setDragGuides, dragGuidesRef, spaceHeldRef]);

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
        // Start a marquee — additive when shift is held. Alt-drag = lasso.
        const world = clientToWorld(e.clientX, e.clientY);
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        const lasso = e.altKey;
        if (!additive) clearSelection();
        if (lasso) {
          lassoPointsRef.current = [world.x, world.y];
        } else {
          lassoPointsRef.current = null;
        }
        setMarquee({
          startWorld: world,
          currentWorld: world,
          initialSelection: additive ? [...selection] : [],
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
        const topZ = (topZRef.current ?? 0) + 1;
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
        const topZ = (topZRef.current ?? 0) + 1;
        setDrawing({
          id, boardId, type: "freehand",
          x: world.x, y: world.y, w: 0, h: 0,
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

      // ─── Comment tool — drop a new thread pin.
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
      // kanban/timer/voting are deliberately NOT drag-to-create because
      // they're composite widgets whose proportions only make sense at
      // known sizes.
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
        const topZ = (topZRef.current ?? 0) + 1;
        const baseProps = {
          id, boardId, version: 1, z: topZ, createdAt: now, updatedAt: now,
          x: world.x, y: world.y, w: 0, h: 0,
        };
        let draft: WhiteboardObject | null = null;
        if (tool === "sticky") {
          draft = { ...baseProps, type: "sticky", content: "", color: stickyColor };
        } else if (tool === "rect" || tool === "ellipse" || tool === "diamond" || tool === "triangle") {
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
      addObjectAt(world.x, world.y);
    },
    [
      tool, addObjectAt, clearSelection, clientToWorld, selection,
      setMarquee, setDrawing, pendingConnectorFromId, setPendingConnectorFromId,
      boardId, upsertCommentThread, setTool, readOnly, canComment,
      camera.x, camera.y, camera.zoom, setActiveCommentThreadId, stickyColor,
      viewportRef, viewportRectRef, spaceHeldRef, topZRef,
    ],
  );

  // ─── Pointer move — pan, marquee, drag, resize, rotation, drawing ───
  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Capture latest pointer position BEFORE any early returns so the
      // chat composer + emoji reactions can still spawn at cursor.
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
          const pts = drawing.points;
          const lastX = pts[pts.length - 2];
          const lastY = pts[pts.length - 1];
          if (Math.hypot(world.x - lastX, world.y - lastY) >= 1) {
            const nextPts = pts.concat([world.x, world.y]);
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

      // ─── Marquee in progress ─────────────────────────────────────────
      if (marquee) {
        const lassoActive = !!marquee.lassoPoints;
        const LASSO_MAX_POINTS = 1000;
        if (lassoActive) {
          if (!lassoPointsRef.current) lassoPointsRef.current = marquee.lassoPoints ? marquee.lassoPoints.slice() : [world.x, world.y];
          const buf = lassoPointsRef.current;
          if (buf.length < LASSO_MAX_POINTS * 2) {
            const lastX = buf[buf.length - 2];
            const lastY = buf[buf.length - 1];
            const dx = world.x - lastX;
            const dy = world.y - lastY;
            const sizeFactor = 1 + buf.length / 400;
            const minDist = (3 * sizeFactor) / Math.max(0.001, camera.zoom);
            if (dx * dx + dy * dy > minDist * minDist) {
              buf.push(world.x, world.y);
            }
          }
          lastLassoWorldRef.current = world;
          if (lassoRafRef.current == null) {
            lassoRafRef.current = requestAnimationFrame(() => {
              lassoRafRef.current = null;
              const cur = lassoPointsRef.current;
              const latestWorld = lastLassoWorldRef.current;
              const liveMarquee = useCanvasStore.getState().marquee;
              if (!cur || !latestWorld || !liveMarquee) return;
              setMarquee({
                ...liveMarquee,
                currentWorld: latestWorld,
                lassoPoints: cur.slice(),
              });
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
          setMarquee({
            ...marquee,
            currentWorld: world,
          });
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

      // ─── Drag in progress ────────────────────────────────────────────
      if (drag) {
        let dx = world.x - drag.startWorld.x;
        let dy = world.y - drag.startWorld.y;
        const ids = Object.keys(drag.initialRects);

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

        const gridFlip = e.metaKey || e.ctrlKey;
        const gridActive = snapToGridEnabled !== gridFlip;
        if (gridActive) {
          const snapped = snapToGridFn({ x: proposedUnion.x, y: proposedUnion.y }, DEFAULT_GRID_SIZE);
          dx += snapped.x - proposedUnion.x;
          dy += snapped.y - proposedUnion.y;
          proposedUnion.x = snapped.x;
          proposedUnion.y = snapped.y;
        }

        if (snapToObjectsEnabled) {
          const zoomAdjustedTol = Math.max(2, DEFAULT_GUIDE_TOLERANCE / (camera.zoom || 1));
          let others;
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
          if (guides.length > 0 || (dragGuidesRef.current?.length ?? 0) > 0) setDragGuides(guides);
        } else if ((dragGuidesRef.current?.length ?? 0) > 0) {
          setDragGuides([]);
        }

        const updates: WhiteboardObject[] = [];
        const now = new Date().toISOString();
        for (const id of ids) {
          const initial = drag.initialRects[id];
          const obj = objectsById.get(id);
          if (!obj) continue;
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

      // ─── Rotation in progress ────────────────────────────────────────
      if (rotation) {
        const dy = world.y - rotation.centerWorld.y;
        const dx = world.x - rotation.centerWorld.x;
        if (Math.hypot(dx, dy) < 1) return;
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        let delta = ((angleDeg - rotation.startAngleDeg + 540) % 360) - 180;
        if (e.shiftKey) delta = Math.round(delta / 15) * 15;
        const updates: WhiteboardObject[] = [];
        const now = new Date().toISOString();
        for (const [id, initRot] of Object.entries(rotation.initialRotations)) {
          const obj = objectsById.get(id);
          if (!obj) continue;
          let r = initRot + delta;
          r = ((r + 180) % 360 + 360) % 360 - 180;
          if (r === -180) r = 180;
          updates.push({ ...obj, rotation: r, version: obj.version + 1, updatedAt: now } as WhiteboardObject);
        }
        if (updates.length === 1) upsert(updates[0]);
        else if (updates.length > 1) upsertMany(updates);
        return;
      }

      // ─── Resize in progress ──────────────────────────────────────────
      if (resize) {
        const dx = world.x - resize.startWorld.x;
        const dy = world.y - resize.startWorld.y;
        const union = resize.initialUnion ?? resize.initialRect;
        const initRects = resize.initialRects ?? { [resize.objectId]: resize.initialRect };
        let unx = union.x, uny = union.y, unw = union.w, unh = union.h;
        if (resize.handle.includes("e")) unw = Math.max(20, union.w + dx);
        if (resize.handle.includes("s")) unh = Math.max(20, union.h + dy);
        if (resize.handle.includes("w")) { unw = Math.max(20, union.w - dx); unx = union.x + (union.w - unw); }
        if (resize.handle.includes("n")) { unh = Math.max(20, union.h - dy); uny = union.y + (union.h - unh); }
        if (e.shiftKey && union.w > 0 && union.h > 0) {
          const sxR = unw / union.w;
          const syR = unh / union.h;
          const isCorner = resize.handle === "nw" || resize.handle === "ne" || resize.handle === "sw" || resize.handle === "se";
          if (isCorner) {
            const s = Math.max(sxR, syR);
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
          const offX = ir.x - union.x;
          const offY = ir.y - union.y;
          const nx = unx + offX * sx;
          const ny = uny + offY * sy;
          const nw = Math.max(20, ir.w * sx);
          const nh = Math.max(20, ir.h * sy);
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
    [
      camera, throttledSetCamera, marquee, drag, resize, rotation, drawing,
      pendingConnectorFromId, objects, objectsById, selection, setSelection,
      setMarquee, setDrawing, upsert, upsertMany, clientToWorld, setDragGuides,
      snapToGridEnabled, snapToObjectsEnabled, publish, setPreviewCursor,
      dragGuidesRef,
    ],
  );

  // ─── Pointer up ──────────────────────────────────────────────────────
  const onCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isPanningRef.current = false;
    lastPointerRef.current = null;
    if (marquee) {
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
        // pushSnapshot was already called at drag START — calling it
        // here would capture the post-drag state and undo would be a
        // no-op.
        if (movedAny) log(CANVAS_ACTIONS.OBJECTS_MOVED, { count: ids.length, ids });
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
        // landed in. Cards dragged OUT of a kanban have their frameId
        // cleared. Skip rotated kanban frames — axis-aligned bounds
        // check no longer matches what the user sees.
        const cardUpdates: WhiteboardObject[] = [];
        if (!readOnly) for (const id of ids) {
          const obj = objectsById.get(id);
          if (!obj || obj.type !== "card") continue;
          const cx = obj.x + obj.w / 2;
          const cy = obj.y + obj.h / 2;
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
          // the kanban-drop changed `obj.status`. Bidirectional sync
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

        // ─── Mind-map drag-to-reparent ─────────────────────────────
        // If the user dragged a mind-map node and dropped it on top
        // of another mind-map node in the same map, reparent the
        // dragged node and re-layout. Cycle guard prevents dropping
        // a node onto one of its own descendants (which would create
        // an infinite tree).
        //
        // The drag-end centre point (current obj position + half
        // size) is the "drop point". We find a candidate target
        // mind-map node whose AABB contains the drop point and whose
        // mindMapId matches the dragged node. The dragged node's
        // own AABB is excluded so a small move-in-place doesn't
        // self-reparent.
        if (!readOnly) {
          const mindMapUpdates = new Map<string, WhiteboardMindMapNode>();
          for (const id of ids) {
            const dragged = objectsById.get(id);
            if (!dragged || dragged.type !== "mindMapNode") continue;
            const cx = dragged.x + dragged.w / 2;
            const cy = dragged.y + dragged.h / 2;
            // Candidate: any other mindMapNode in the same map
            // whose AABB contains the drop point. Pick the
            // top-most (highest z) when multiple match.
            const candidate = objects
              .filter((o): o is WhiteboardMindMapNode =>
                o.type === "mindMapNode" &&
                o.id !== id &&
                o.mindMapId === dragged.mindMapId &&
                cx >= o.x && cx <= o.x + o.w &&
                cy >= o.y && cy <= o.y + o.h,
              )
              .sort((a, b) => b.z - a.z)[0];
            if (!candidate) continue;
            // Already this node's parent? Nothing to do.
            if (dragged.parentNodeId === candidate.id) continue;
            // Cycle guard — refuse to drop a node onto one of its
            // own descendants.
            const family = objects.filter(
              (o): o is WhiteboardMindMapNode =>
                o.type === "mindMapNode" && o.mindMapId === dragged.mindMapId,
            );
            if (isMindMapDescendant(id, candidate.id, family)) continue;

            // Apply the reparent and re-layout the whole family.
            const reparented: WhiteboardMindMapNode = {
              ...dragged,
              parentNodeId: candidate.id,
              version: dragged.version + 1,
              updatedAt: new Date().toISOString(),
            };
            const familyMap = new Map<string, WhiteboardMindMapNode>();
            for (const n of family) familyMap.set(n.id, n);
            familyMap.set(id, reparented);
            const familyArr = Array.from(familyMap.values());
            const rootNode = familyArr.find((n) => !n.parentNodeId);
            const rootAnchor = rootNode ? { x: rootNode.x, y: rootNode.y } : null;
            const positions = layoutMindMap(familyArr, rootAnchor);
            const now2 = new Date().toISOString();
            for (const fam of familyArr) {
              const pos = positions.get(fam.id);
              if (!pos) continue;
              const moved = pos.x !== fam.x || pos.y !== fam.y;
              const isStructural = fam.id === id;
              if (!moved && !isStructural) continue;
              mindMapUpdates.set(fam.id, {
                ...fam,
                x: pos.x,
                y: pos.y,
                version: fam.version + (isStructural ? 0 : 1),
                updatedAt: now2,
              });
            }
            // Make sure the reparented node lands even if it didn't
            // visually move (rare — usually layout re-positions it).
            if (!mindMapUpdates.has(id)) mindMapUpdates.set(id, reparented);
          }
          if (mindMapUpdates.size > 0) {
            upsertMany(Array.from(mindMapUpdates.values()));
            log(CANVAS_ACTIONS.OBJECT_UPDATED, { count: mindMapUpdates.size, action: "mindmap-reparent" });
          }
        }
      }
      // Release the spatial index so the candidate rects can be GC'd;
      // next drag-start rebuilds with fresh objects.
      dragSnapIndexRef.current = null;
      setDrag(null);
      if ((dragGuidesRef.current?.length ?? 0) > 0) setDragGuides([]);
    }
    if (resize) {
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
      if (!isTrivial && !readOnly) {
        pushSnapshot();
        upsert(drawing);
        log(CANVAS_ACTIONS.OBJECT_ADDED, { id: drawing.id, type: drawing.type });
        setSelection([drawing.id]);
      }
      createStartRef.current = null;
      setDrawing(null);
      setTool("select");
    }
    viewportRef.current?.releasePointerCapture(e.pointerId);
  }, [
    marquee, drag, resize, rotation, drawing,
    setMarquee, setDrag, setResize, setRotation, setDrawing,
    setTool, setSelection, setEditingObjectId,
    upsert, upsertMany, log, logActivity, setDragGuides, pushSnapshot,
    objectsById, objects, readOnly,
    viewportRef, dragGuidesRef,
  ]);

  return {
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    dragSnapIndexRef,
    lastPointerRef,
    isPanningRef,
    lassoRafRef,
    lassoPointsRef,
    lastLassoWorldRef,
  };
}
