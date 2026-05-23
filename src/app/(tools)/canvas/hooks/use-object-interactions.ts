"use client";

import { useCallback, type RefObject, type MutableRefObject } from "react";
import { wbId } from "@/lib/whiteboard/clipboard";
import { buildSpatialIndex, type SpatialIndex } from "@/lib/whiteboard/snap";
import { claimNextZ } from "@/lib/whiteboard/z-order";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import type { Rect } from "@/lib/geometry/bbox";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import type { CanvasTool, ResizeHandle } from "../use-canvas-store";

type LogFn = ReturnType<typeof useHistoryLogger>["log"];

type DragState = { startWorld: { x: number; y: number }; initialRects: Record<string, Rect> };
type ResizeState = {
  handle: ResizeHandle;
  startWorld: { x: number; y: number };
  initialRect: Rect;
  objectId: string;
  initialRects?: Record<string, Rect>;
  initialUnion?: Rect;
};
type RotationState = {
  centerWorld: { x: number; y: number };
  startAngleDeg: number;
  initialRotations: Record<string, number>;
};

/**
 * Object-level event handlers wired into `<ObjectRenderer>`,
 * `<SelectionHandles>`, and `<ConnectorLayer>`.
 *
 * Distinct from the canvas-level pointer machine: those handlers
 * fire on the empty viewport; these fire on individual objects (or
 * the resize/rotation handles attached to a selection).
 *
 *  - `onObjectPointerDown` — click an object. Branches: read-only
 *    selects only, hand tool ignores, connector tool runs the two-
 *    click wiring flow, otherwise starts a drag (builds the snap
 *    spatial index into `dragSnapIndexRef` for the pointer-machine
 *    to consume).
 *
 *  - `onObjectDoubleClick` — enter inline-edit mode for text-bearing
 *    objects (sticky / text / shape).
 *
 *  - `onCommitObjectEdit` — write edited text back to the right
 *    object field (sticky/text/shape → content, frame/kanban/timer →
 *    label, card → title, voting → question). Bumps version so peers
 *    receive the change.
 *
 *  - `onPatchStyles` — multi-object style patch from the floating
 *    property panel. Snapshots + version-bumps once per batch.
 *
 *  - `onObjectMutate` — stable per-object adapter passed to every
 *    <ObjectRenderer>. Without identity stability, memoised renderers
 *    blow their cache on every parent re-render (60 Hz during drag).
 *
 *  - `onConnectorPointerDown` — toggle-select a connector path. No
 *    drag because connectors don't have a draggable bbox.
 *
 *  - `onResizeHandlePointerDown` / `onRotateStart` / `onRotateByDelta`
 *    — gesture initiators for the resize and rotation handles. The
 *    actual pointer-move/up state machine lives in the pointer
 *    machine; these just seed the resize/rotation state.
 */
export function useObjectInteractions(params: {
  // Workspace
  boardId: string;
  objects: readonly WhiteboardObject[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  upsert: (obj: WhiteboardObject) => void;
  upsertMany: (objs: WhiteboardObject[]) => void;
  // Selection + tool
  tool: CanvasTool;
  setTool: (t: CanvasTool) => void;
  selection: readonly string[];
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive?: boolean) => void;
  // Ephemeral state
  pendingConnectorFromId: string | null;
  setPendingConnectorFromId: (id: string | null) => void;
  setDrag: (d: DragState | null) => void;
  setMarquee: (m: null) => void;
  setResize: (r: ResizeState | null) => void;
  setRotation: (r: RotationState | null) => void;
  setEditingObjectId: (id: string | null) => void;
  // Refs (from useViewportSize and the pointer machine)
  viewportRef: RefObject<HTMLDivElement | null>;
  dragSnapIndexRef: MutableRefObject<SpatialIndex | null>;
  topZRef: RefObject<number>;
  // Coords
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  // Undo + logging
  pushSnapshot: () => void;
  log: LogFn;
  logActivity: (kind: string, summary: string) => void;
  // Mode
  readOnly: boolean;
}) {
  const {
    boardId, objects, objectsById, upsert, upsertMany,
    tool, setTool, selection, setSelection, toggleSelection,
    pendingConnectorFromId, setPendingConnectorFromId,
    setDrag, setMarquee, setResize, setRotation, setEditingObjectId,
    viewportRef, dragSnapIndexRef, topZRef,
    clientToWorld,
    pushSnapshot, log, logActivity,
    readOnly,
  } = params;

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      // Read-only: allow selection (so viewers can highlight things
      // to talk about in chat) but block every mutating side-effect.
      if (readOnly) {
        setSelection([id]);
        return;
      }
      if (tool === "hand") return;

      // Connector tool — two-click flow.
      if (tool === "connector") {
        const target = objectsById.get(id);
        if (!target) return;
        // Acceptable connector endpoints. Phase 25+ adds card/kanban/
        // timer/voting/table/mindMapNode/diagramShape — without those
        // here, the connector tool silently no-ops when the user clicks
        // one of those object types (no cursor change, no toast, just
        // dead click). Keep in sync with WhiteboardObjectKind.
        const valid = [
          "sticky", "rect", "ellipse", "diamond", "triangle",
          "frame", "image",
          "card", "kanban", "timer", "voting",
          "table", "mindMapNode", "diagramShape",
        ];
        if (!valid.includes(target.type)) return;
        if (!pendingConnectorFromId) {
          setPendingConnectorFromId(id);
          return;
        }
        if (pendingConnectorFromId === id) {
          setPendingConnectorFromId(null);
          return;
        }
        // Re-check that the pending source still exists — the user could
        // have deleted it while it was pending (Delete works even while
        // the connector tool is active). Without this we'd persist a
        // connector with a dangling fromId that the renderer silently
        // skips, leaving a phantom row in the workspace store.
        if (!objectsById.has(pendingConnectorFromId)) {
          setPendingConnectorFromId(null);
          return;
        }
        const newId = wbId("wb");
        const now = new Date().toISOString();
        upsert({
          id: newId,
          boardId,
          type: "connector",
          x: 0, y: 0, w: 0, h: 0,
          z: claimNextZ(topZRef),
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
      // selects all members of that group. Hold a modifier to bypass
      // the expansion (select just the clicked member).
      const target = objectsById.get(id);
      const groupId = !additive && target?.groupId ? target.groupId : null;
      const groupMembers = groupId
        ? objects.filter((o) => o.groupId === groupId).map((o) => o.id)
        : null;

      // Decide the new selection synchronously so we can also start
      // dragging immediately without waiting for state to flush.
      let nextSelection: string[];
      if (additive) {
        nextSelection = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
      } else if (groupMembers && groupMembers.length > 1) {
        nextSelection = groupMembers;
      } else if (!selection.includes(id)) {
        nextSelection = [id];
      } else {
        nextSelection = [...selection];
      }
      if (nextSelection !== selection) setSelection(nextSelection);
      // Start a drag (only with select tool and a non-empty selection).
      if (tool !== "select" || nextSelection.length === 0) return;
      const world = clientToWorld(e.clientX, e.clientY);
      const initialRects: Record<string, Rect> = {};
      let anyMovable = false;
      for (const sid of nextSelection) {
        const o = objectsById.get(sid);
        if (!o) continue;
        // Locked objects skip the drag — still selectable.
        if (o.locked) continue;
        anyMovable = true;
        initialRects[sid] = { x: o.x, y: o.y, w: o.w, h: o.h };
      }
      if (!anyMovable) return;
      // Snapshot BEFORE the drag starts mutating the store. The
      // pointer-move handler updates positions on every frame, so by
      // pointer-up the store is already at post-drag — snapshot there
      // would record post-drag and Cmd+Z would be a no-op.
      pushSnapshot();
      // Build the snap spatial index ONCE for this drag. The candidate
      // set (every non-dragging object) is invariant during the drag;
      // rebuilding per pointer-move is wasteful.
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
    [tool, selection, setSelection, clientToWorld, objectsById, setDrag, pendingConnectorFromId, setPendingConnectorFromId, upsert, boardId, objects, log, setTool, pushSnapshot, readOnly, viewportRef, dragSnapIndexRef, topZRef],
  );

  const onObjectDoubleClick = useCallback(
    (id: string) => {
      if (readOnly) return;
      const obj = objectsById.get(id);
      if (!obj) return;
      const editable = obj.type === "sticky" || obj.type === "text"
        || obj.type === "rect" || obj.type === "ellipse"
        || obj.type === "diamond" || obj.type === "triangle"
        // Connectors: double-click anywhere on the path opens label edit.
        // Frame/kanban/timer/card already have their own edit paths
        // (label tab / detail modal) so they're handled elsewhere.
        || obj.type === "connector"
        // Mind-map nodes: double-click opens the node's text editor.
        || obj.type === "mindMapNode"
        // Diagram shapes: double-click edits the label.
        || obj.type === "diagramShape";
      if (!editable) return;
      if (obj.locked) return;
      // Bail out of any pre-edit gestures so the textarea isn't
      // fighting a drag mid-mount.
      setDrag(null);
      setMarquee(null);
      setEditingObjectId(id);
      // Make sure the object is selected so selection chrome lines up
      // with the editor (and post-edit Esc clears something sane).
      if (!(selection.length === 1 && selection[0] === id)) {
        setSelection([id]);
      }
    },
    [readOnly, objectsById, selection, setSelection, setDrag, setMarquee, setEditingObjectId],
  );

  const onCommitObjectEdit = useCallback(
    (id: string, text: string) => {
      // ReadOnly defense-in-depth: even though Enter/double-click are
      // gated, if an InlineEditor somehow surfaces (e.g. DOM hack),
      // refuse to commit. Still clear the edit flag so the UI doesn't
      // get stuck.
      if (readOnly) { setEditingObjectId(null); return; }
      const obj = objectsById.get(id);
      if (!obj) { setEditingObjectId(null); return; }
      // Pick the right field by type. Sticky/text/shape store editable
      // text in `content`; frame/kanban/timer use `label`; card uses
      // `title`; voting uses `question`. Previously this always wrote
      // to `content`, producing a phantom `content: text` field on
      // frame edits that never rendered anywhere.
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
        connector: "label",
        mindMapNode: "text",
        diagramShape: "label",
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
        // Truncate preview to 40 chars so a 5kb sticky doesn't bloat
        // the activity stream.
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

  const onPatchStyles = useCallback(
    (entries: { id: string; patch: Partial<WhiteboardObject> }[]) => {
      // ReadOnly: PropertyPanel is hidden in viewer/commenter mode,
      // but defense-in-depth against a hacked DOM injecting a panel.
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

  // Stable per-object onMutate adapter — passed to every
  // <ObjectRenderer> so the memoised renderer doesn't blow its cache
  // on identity churn. The JSX used to create a fresh arrow on every
  // parent render, defeating memoisation at 60 Hz during drag (60_000
  // ObjectRenderer reconciliations / sec at 1000 objects). Stabilising
  // this callback identity drops that to just the ~20 objects that
  // actually changed each frame.
  const onObjectMutate = useCallback(
    (id: string, patch: Partial<WhiteboardObject>) => onPatchStyles([{ id, patch }]),
    [onPatchStyles],
  );

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

  const onResizeHandlePointerDown = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent) => {
      if (selection.length === 0) return;
      // Collect every (non-locked) selected object's initial rect so
      // multi-object resize scales each one proportionally to the
      // union bbox change. Locked objects excluded — toolbar still
      // works for the remaining objects, matching drag / align.
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
      // Snapshot BEFORE the resize starts mutating. Pointer-move edits
      // w/h on every frame; snapshotting at pointer-up would record
      // post-resize and undo would no-op.
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
    [selection, objectsById, clientToWorld, setResize, pushSnapshot, viewportRef],
  );

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
        // Bump `version` so peers honour the LWW comparison. Without it,
        // peers see an unchanged version and treat the rotation as an
        // out-of-date echo, silently rejecting the rotate-button click.
        updates.push({ ...o, rotation: r, version: o.version + 1, updatedAt: now } as WhiteboardObject);
      }
      if (updates.length > 0) upsertMany(updates);
    },
    [selection, objectsById, upsertMany, pushSnapshot],
  );

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
      // Angle in degrees from centre → pointer. atan2 returns radians;
      // we keep degrees to match the data model's `rotation` field.
      const startAngleDeg = (Math.atan2(world.y - center.y, world.x - center.x) * 180) / Math.PI;
      pushSnapshot();
      setRotation({
        centerWorld: center,
        startAngleDeg,
        initialRotations,
      });
      viewportRef.current?.setPointerCapture(e.pointerId);
    },
    [selection, objectsById, clientToWorld, setRotation, pushSnapshot, viewportRef],
  );

  return {
    onObjectPointerDown,
    onObjectDoubleClick,
    onCommitObjectEdit,
    onPatchStyles,
    onObjectMutate,
    onConnectorPointerDown,
    onResizeHandlePointerDown,
    onRotateByDelta,
    onRotateStart,
  };
}
