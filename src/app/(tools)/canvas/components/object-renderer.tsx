"use client";

import React, { memo } from "react";
import type {
  WhiteboardObject,
  WhiteboardTimer,
  WhiteboardVoting,
  WhiteboardCard,
} from "@/lib/stores/workspace-types";
import { TimerObject } from "./objects/timer-object";
import { VotingObject } from "./objects/voting-object";
import { CardObject } from "./objects/card-object";
import { TableObject } from "./objects/table-object";
import type {
  WhiteboardTable,
  WhiteboardMindMapNode,
  WhiteboardDiagramShape,
} from "@/lib/stores/workspace-types";
import { MindMapNode } from "./objects/mind-map-node";
import { DiagramShape } from "./objects/diagram-shape";
import { StickyObject } from "./objects/sticky-object";
import { ShapeObject } from "./objects/shape-object";
import { TextObject } from "./objects/text-object";
import { FrameObject } from "./objects/frame-object";
import { LineObject } from "./objects/line-object";
import { FreehandObject } from "./objects/freehand-object";
import { ImageObject } from "./objects/image-object";
import { EmbedObject } from "./objects/embed-object";
import { KanbanObject } from "./objects/kanban-object";

/**
 * Render a rich-text content string for read-only display. Sanitizes
 * defensively — even if the local editor produced clean HTML, peer
 * patches over realtime might carry unsanitized strings, and this is
 * the only barrier between them and `dangerouslySetInnerHTML`.
 *
 * Returns an empty fragment when the HTML is effectively empty so
 * the caller can fall back to placeholder text.
 */
interface ObjectRendererProps {
  object: WhiteboardObject;
  selected: boolean;
  /** True when this object is currently being inline-edited (textarea
   * overlays the static content). Only stickies, text, and shapes with
   * inner content respond to this flag. */
  editing?: boolean;
  onPointerDown?: (e: React.PointerEvent, id: string) => void;
  /** Called on double-click — viewport handles deciding which types are
   * editable and sets editingObjectId in the canvas store. */
  onDoubleClick?: (id: string) => void;
  /** Commit the new text. Called on textarea blur, on Enter (without
   * Shift), or on Esc (treated as commit; users expect their typing to
   * stick rather than disappear on accidental Esc). */
  onCommitEdit?: (id: string, text: string) => void;
  /** Stateful object mutators (timer / voting / card) — version-bumps
   * + persists via the canvas's diff-sync upstream. */
  onMutate?: (id: string, patch: Partial<WhiteboardObject>) => void;
  /** Current user id — passed to voting widget so it knows which
   * vote belongs to "me". */
  selfId?: string;
  /** Mind-map structural action from inside the node editor. Only
   * wired for `mindMapNode` objects; other types ignore. */
  onMindMapStructural?: (
    id: string,
    action: "child" | "sibling" | "promote",
    committedText: string
  ) => void;
  /** Set of mind-map node ids that have at least one child. Used to
   * decide whether the collapse/expand toggle renders. Precomputed
   * upstream so ObjectRenderer doesn't walk the whole object list
   * per node. */
  mindMapHasChildrenSet?: ReadonlySet<string>;
}

/**
 * Stateless render of a single whiteboard object. All interactivity is
 * delegated up via `onPointerDown` — the viewport decides whether to
 * start a drag, open an editor, etc.
 *
 * The renderer is split per-type via a switch, each branch kept simple
 * so future tweaks land cleanly. Memoised so a 100-object board doesn't
 * re-render every object on every camera tick.
 */
function ObjectRendererImpl({
  object: o,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onCommitEdit,
  onMutate,
  selfId,
  onMindMapStructural,
  mindMapHasChildrenSet,
}: ObjectRendererProps) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);

  switch (o.type) {
    case "sticky":
      return (
        <StickyObject
          object={o}
          selected={selected}
          editing={editing}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          onCommitEdit={onCommitEdit}
        />
      );

    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle":
      return (
        <ShapeObject
          object={o}
          selected={selected}
          editing={editing}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          onCommitEdit={onCommitEdit}
        />
      );

    case "text":
      return (
        <TextObject
          object={o}
          selected={selected}
          editing={editing}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          onCommitEdit={onCommitEdit}
        />
      );

    case "frame":
      return (
        <FrameObject
          object={o}
          selected={selected}
          editing={editing}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          onCommitEdit={onCommitEdit}
          onMutate={onMutate}
        />
      );

    case "line":
    case "arrow":
      return <LineObject object={o} selected={selected} onPointerDown={onPointerDown} />;

    case "freehand":
      return <FreehandObject object={o} selected={selected} onPointerDown={onPointerDown} />;

    case "image":
      return <ImageObject object={o} selected={selected} onPointerDown={onPointerDown} />;

    case "embed":
      return <EmbedObject object={o} selected={selected} onPointerDown={onPointerDown} />;

    case "timer":
      return (
        <TimerObject
          object={o as WhiteboardTimer}
          selected={selected}
          onPointerDown={handle}
          onMutate={(patch) => onMutate?.(o.id, patch as Partial<WhiteboardObject>)}
        />
      );

    case "voting":
      return (
        <VotingObject
          object={o as WhiteboardVoting}
          selected={selected}
          selfId={selfId ?? "anonymous"}
          onPointerDown={handle}
          onMutate={(patch) => onMutate?.(o.id, patch as Partial<WhiteboardObject>)}
        />
      );

    case "card":
      return (
        <CardObject
          object={o as WhiteboardCard}
          selected={selected}
          editing={editing ?? false}
          onPointerDown={handle}
          onDoubleClick={() => onDoubleClick?.(o.id)}
          onCommitEdit={(text) => onCommitEdit?.(o.id, text)}
        />
      );

    case "table":
      return (
        <TableObject
          object={o as WhiteboardTable}
          selected={selected}
          readOnly={!onMutate}
          onPointerDown={handle}
          onMutate={(id, patch) => onMutate?.(id, patch)}
        />
      );

    case "diagramShape":
      return (
        <DiagramShape
          object={o as WhiteboardDiagramShape}
          selected={selected}
          editing={editing ?? false}
          onPointerDown={handle}
          onDoubleClick={() => onDoubleClick?.(o.id)}
          onCommitEdit={(text) => onCommitEdit?.(o.id, text)}
        />
      );

    case "mindMapNode":
      return (
        <MindMapNode
          object={o as WhiteboardMindMapNode}
          selected={selected}
          editing={editing ?? false}
          // hasChildren is precomputed upstream so we don't walk the
          // full object list per render. CanvasWorldLayer builds the
          // Set once per object-array change and passes it in.
          hasChildren={mindMapHasChildrenSet?.has(o.id) ?? false}
          onPointerDown={handle}
          onDoubleClick={() => onDoubleClick?.(o.id)}
          onCommitEdit={(text) => onCommitEdit?.(o.id, text)}
          onMutate={(patch) => onMutate?.(o.id, patch as Partial<WhiteboardObject>)}
          onStructuralAction={
            onMindMapStructural
              ? (action, text) => onMindMapStructural(o.id, action, text)
              : undefined
          }
        />
      );

    case "kanban":
      return <KanbanObject object={o} selected={selected} onPointerDown={onPointerDown} />;

    default:
      // `connector` is rendered separately in a single SVG layer covering
      // the whole canvas — connectors reference other objects' positions,
      // so it's easier to draw them once with all positions known.
      return null;
  }
}

export const ObjectRenderer = memo(ObjectRendererImpl);
