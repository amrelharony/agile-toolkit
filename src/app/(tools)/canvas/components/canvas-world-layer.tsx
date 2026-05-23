"use client";

import { useMemo, type CSSProperties } from "react";
import type { Camera, Rect } from "@/lib/geometry/bbox";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { ConnectorLayer } from "./connector-layer";
import { ObjectRenderer } from "./object-renderer";
import { MindMapEdges } from "./mind-map-edges";

// Module-scope dimmed-wrapper style for tag-filter dimming. Hoisted
// out of the render path so a 1000-object board doesn't allocate
// 1000 fresh inline-style objects per render — React's shallow
// style-diff reconciliation depends on referential stability to
// skip style writes.
const DIMMED_WRAPPER_STYLE: CSSProperties = {
  opacity: 0.25,
  transition: "opacity 120ms",
};

/**
 * The world-space rendering layer.
 *
 * Everything inside is positioned in world coords (the parent applies
 * the camera transform). Renders, in z-order:
 *
 *   1. `<ConnectorLayer>` — drawn first so connectors sit BEHIND
 *      sticky / shape objects rather than over them.
 *   2. `visibleObjects.map(...)` — every object whose AABB intersects
 *      the viewport (selected/editing objects are always included
 *      regardless of position). Tag-filter dimming wraps non-matching
 *      objects in a 25% opacity div; when no tag filter is active we
 *      skip the wrapper entirely so 1000-object boards don't pay for
 *      1000 extra DOM nodes.
 *   3. `<ObjectRenderer object={drawing} />` — the in-progress
 *      drawing preview (drag-to-create shape, lasso polygon, etc.)
 *      rendered through the same renderer as committed objects so
 *      what-you-see-is-what-you-get during drag.
 */
export function CanvasWorldLayer(props: {
  camera: Camera;
  objects: readonly WhiteboardObject[];
  visibleObjects: readonly WhiteboardObject[];
  selection: readonly string[];
  selectionSet: ReadonlySet<string>;
  pendingConnectorFromId: string | null;
  previewCursor: { x: number; y: number } | null;
  viewportWorld: Rect | null;
  drawing: WhiteboardObject | null;
  editingObjectId: string | null;
  tagFilter: readonly string[];
  tagFilterSet: ReadonlySet<string>;
  selfId: string;
  onConnectorPointerDown: (id: string, e: React.PointerEvent) => void;
  onObjectPointerDown: (e: React.PointerEvent, id: string) => void;
  onObjectDoubleClick: (id: string) => void;
  onCommitObjectEdit: (id: string, text: string) => void;
  onObjectMutate: (id: string, patch: Partial<WhiteboardObject>) => void;
  onMindMapStructural?: (id: string, action: "child" | "sibling" | "promote", committedText: string) => void;
}) {
  const {
    camera, objects, visibleObjects, selection, selectionSet,
    pendingConnectorFromId, previewCursor, viewportWorld,
    drawing, editingObjectId, tagFilter, tagFilterSet, selfId,
    onConnectorPointerDown, onObjectPointerDown, onObjectDoubleClick,
    onCommitObjectEdit, onObjectMutate, onMindMapStructural,
  } = props;

  // Whether the currently-edited object is a connector. ConnectorLayer
  // reads this to switch a connector from `<text>` label to the inline
  // `<foreignObject>` editor. Lifted from the editingObjectId + a
  // type-lookup so ConnectorLayer doesn't need the full object map.
  const editingConnectorId = editingObjectId
    && objects.find((o) => o.id === editingObjectId)?.type === "connector"
    ? editingObjectId
    : null;

  // Precompute "which mind-map nodes have at least one child" so
  // ObjectRenderer doesn't walk the object list per render to decide
  // whether to show the collapse toggle. Rebuilt only when the
  // objects array identity changes (Zustand swaps the ref on every
  // mutation), which is roughly the same cadence as a layout
  // re-render anyway.
  const mindMapHasChildrenSet = useMemo(() => {
    const out = new Set<string>();
    for (const o of objects) {
      if (o.type === "mindMapNode" && o.parentNodeId) out.add(o.parentNodeId);
    }
    return out;
  }, [objects]);

  return (
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
        {/* Mind-map edges render behind objects + connectors so the
            cubic Béziers sit visually beneath the node bubbles. */}
        <MindMapEdges objects={objects} />
        <ConnectorLayer
          objects={objects}
          selectedIds={selection}
          preview={
            pendingConnectorFromId && previewCursor
              ? { fromId: pendingConnectorFromId, toWorld: previewCursor }
              : null
          }
          onConnectorPointerDown={onConnectorPointerDown}
          onConnectorDoubleClick={onObjectDoubleClick}
          editingConnectorId={editingConnectorId}
          onCommitConnectorLabel={onCommitObjectEdit}
          viewportWorld={viewportWorld}
        />
        {visibleObjects.map((o) => {
          // Tag-filter dimming (Phase 26). When the user has at least
          // one tag in the filter set, any object that doesn't carry
          // one of those tags is rendered at 25% opacity. Pointer
          // events stay enabled so users can still click through and
          // clear the filter if they need to grab a dimmed object —
          // Miro's behaviour. When NO tag filter is active (the
          // common case), we skip the wrapping <div> entirely.
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
                onMindMapStructural={onMindMapStructural}
                mindMapHasChildrenSet={mindMapHasChildrenSet}
                selfId={selfId}
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
                onMindMapStructural={onMindMapStructural}
                mindMapHasChildrenSet={mindMapHasChildrenSet}
                selfId={selfId}
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
  );
}
