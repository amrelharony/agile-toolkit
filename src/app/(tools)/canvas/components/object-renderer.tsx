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
import { TiptapInlineEditor } from "./tiptap-inline-editor";
import { flatPointsToPath } from "@/lib/whiteboard/freehand";
import {
  isRichHtml,
  safeImageSrc,
  iframeSandboxFor,
  embedIframeUrl,
  arrowheadPoints,
} from "../lib/object-render-utils";
import {
  RichContent,
  InlineEditor,
  LockBadge,
  FramePresenterNotesAffordance,
} from "./objects/object-render-primitives";

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
  const dblClick = () => onDoubleClick?.(o.id);
  const commitEdit = (text: string) => onCommitEdit?.(o.id, text);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

  switch (o.type) {
    case "sticky": {
      // Sticky font scales with the SHORTER dimension so a tall-thin
      // sticky still fits text horizontally and a stretched-wide sticky
      // still keeps text vertically. Floor 16 (smallest legible body
      // text), ceiling 64 (huge stickies read like posters — a 500×400
      // sticky should have giant text, not tiny chrome-sized text).
      // Divisor 7 keeps the scaling visually pleasant:
      //
      //   80×60 (thumbnail) → 60/7=8 → floor 16
      //   200×160 (default) → 160/7=22 → 22 px
      //   400×300           → 300/7=42 → 42 px
      //   600×500           → 500/7=71 → ceiling 64
      //
      // Respects an explicitly-set `fontSize` if the user has
      // customised it via the property panel — only the auto-default
      // case is scaled.
      const stickyFontSize =
        o.fontSize ?? Math.max(16, Math.min(64, Math.floor(Math.min(o.w, o.h) / 7)));
      return (
        <div
          data-canvas-object-kind="sticky"
          onPointerDown={editing ? undefined : handle}
          onDoubleClick={dblClick}
          style={{
            position: "absolute",
            // `transform: translate3d` instead of left/top so the browser
            // promotes each object to its own GPU layer; left/top mutations
            // trigger layout, transform mutations only compositor work. At
            // 500 objects with frequent drags this is the difference
            // between a steady 60 fps and a stuttering 20 fps.
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            background: o.color,
            color: o.textColor ?? "#0b0f17",
            padding: 10,
            boxSizing: "border-box",
            borderRadius: 6,
            fontSize: stickyFontSize,
            lineHeight: 1.2,
            fontFamily: o.fontFamily ?? "ui-sans-serif, system-ui, sans-serif",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            cursor: editing ? "text" : o.locked ? "default" : "move",
            userSelect: editing ? "text" : "none",
            boxShadow: selected ? selectionStyle?.boxShadow : "0 1px 3px rgba(0,0,0,0.3)",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
          }}
        >
          {editing ? (
            <TiptapInlineEditor
              initialText={o.content}
              onCommit={commitEdit}
              background="transparent"
              color={o.textColor ?? "#0b0f17"}
              fontSize={stickyFontSize}
            />
          ) : isRichHtml(o.content) ? (
            <RichContent html={o.content} />
          ) : (
            o.content || <span style={{ opacity: 0.4 }}>Sticky note</span>
          )}
          {o.locked && !editing && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle": {
      const fill = o.fill ?? "transparent";
      const stroke = o.stroke ?? "#94a3b8";
      const strokeWidth = o.strokeWidth ?? 1.5;
      const strokeDasharray = o.dashed ? "6 4" : undefined;
      let shape: React.ReactNode = null;
      if (o.type === "rect") {
        shape = (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={o.w - strokeWidth}
            height={o.h - strokeWidth}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            rx={4}
          />
        );
      } else if (o.type === "ellipse") {
        shape = (
          <ellipse
            cx={o.w / 2}
            cy={o.h / 2}
            rx={Math.max(0, o.w / 2 - strokeWidth / 2)}
            ry={Math.max(0, o.h / 2 - strokeWidth / 2)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      } else if (o.type === "diamond") {
        shape = (
          <polygon
            points={`${o.w / 2},0 ${o.w},${o.h / 2} ${o.w / 2},${o.h} 0,${o.h / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      } else {
        shape = (
          <polygon
            points={`${o.w / 2},0 ${o.w},${o.h} 0,${o.h}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      }
      return (
        <div
          data-canvas-object-kind={o.type}
          onPointerDown={editing ? undefined : handle}
          onDoubleClick={dblClick}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            cursor: editing ? "text" : o.locked ? "default" : "move",
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
            zIndex: o.z,
          }}
        >
          <svg width={o.w} height={o.h} style={{ display: "block" }}>
            {shape}
          </svg>
          {/* Shape font scales with the smaller dimension. Floor 16
              (matches sticky body text — smallest legible content) and
              ceiling 64 (matches sticky — a huge shape gets poster-
              sized text, not chrome-sized). Divisor 7 keeps the ramp
              the same shape as sticky:
                  80×60 thumbnail → 16 px floor
                  160×120 default → 17 px
                  400×300         → 42 px
                  600×500+        → 64 px ceiling
              Previously this was floor 14 / ceiling 32, which made
              shape text noticeably smaller than sticky text on
              identically-sized objects — inconsistent across types. */}
          {(() => {
            const shapeFontSize = Math.max(16, Math.min(64, Math.floor(Math.min(o.w, o.h) / 7)));
            return editing ? (
              <InlineEditor
                initialText={o.content ?? ""}
                onCommit={commitEdit}
                color="#e5e7eb"
                fontSize={shapeFontSize}
                align="center"
                padding={8}
              />
            ) : (
              o.content && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#e5e7eb",
                    fontSize: shapeFontSize,
                    fontFamily: "ui-sans-serif, system-ui, sans-serif",
                    textAlign: "center",
                    padding: 8,
                    pointerEvents: "none",
                    lineHeight: 1.2,
                    wordBreak: "break-word",
                  }}
                >
                  {o.content}
                </div>
              )
            );
          })()}
          {o.locked && !editing && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "text":
      return (
        <div
          data-canvas-object-kind="text"
          onPointerDown={editing ? undefined : handle}
          onDoubleClick={dblClick}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            minHeight: o.h,
            color: o.color,
            fontSize: o.fontSize,
            fontWeight: o.fontWeight ?? 400,
            textAlign: o.align ?? "left",
            cursor: editing ? "text" : o.locked ? "default" : "move",
            opacity: o.locked ? 0.85 : 1,
            userSelect: editing ? "text" : "none",
            fontFamily: o.fontFamily ?? "ui-sans-serif, system-ui, sans-serif",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            ...selectionStyle,
            zIndex: o.z,
          }}
        >
          {editing ? (
            <TiptapInlineEditor
              initialText={o.content}
              onCommit={commitEdit}
              color={o.color}
              fontSize={o.fontSize}
              fontWeight={o.fontWeight ?? 400}
              align={o.align ?? "left"}
              padding={0}
            />
          ) : isRichHtml(o.content) ? (
            <RichContent html={o.content} />
          ) : (
            o.content || <span style={{ opacity: 0.4 }}>Text</span>
          )}
          {o.locked && !editing && <LockBadge z={o.z} />}
        </div>
      );

    case "frame":
      return (
        <div
          data-canvas-object-kind="frame"
          onPointerDown={editing ? undefined : handle}
          onDoubleClick={dblClick}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            border: "1px dashed #475569",
            borderRadius: 8,
            background: o.fill ?? "transparent",
            zIndex: o.z,
            pointerEvents: "auto",
            cursor: editing ? "text" : o.locked ? "default" : "move",
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          {/* Label tab above the frame. Bumped from 12 → 14 px so it's
              readable at a normal zoom level — the prior size matched
              the toolbar font, blurring the line between frame chrome
              and frame content. Double-click swaps the static label
              for an InlineEditor; onCommitEdit routes the new text
              into `frame.label` via the type-aware commit handler in
              whiteboard-canvas.tsx. */}
          <div
            style={{
              position: "absolute",
              top: -26,
              left: 6,
              fontSize: 14,
              fontWeight: 600,
              color: "#cbd5e1",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              background: "#0b0f17",
              padding: "2px 8px",
              borderRadius: 4,
              minWidth: 60,
              minHeight: 20,
              display: "flex",
              alignItems: "center",
            }}
            // Stop drag from starting when the user clicks the label tab
            // to enter edit mode.
            onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
          >
            {editing ? (
              <InlineEditor
                initialText={o.label ?? ""}
                onCommit={commitEdit}
                background="transparent"
                color="#e5e7eb"
                fontSize={14}
                fontWeight={600}
                padding={0}
              />
            ) : (
              o.label || <span style={{ opacity: 0.5 }}>Frame</span>
            )}
          </div>
          {o.locked && !editing && <LockBadge z={o.z} />}
          {selected && !editing && onMutate && (
            <FramePresenterNotesAffordance
              notes={o.presenterNotes ?? ""}
              onCommit={(text) =>
                onMutate(o.id, { presenterNotes: text } as Partial<WhiteboardObject>)
              }
            />
          )}
        </div>
      );

    case "line":
    case "arrow": {
      // World coords: (x, y) start; (x+w, y+h) end. We render into a
      // bounding-box SVG and align with absolute positioning.
      const minX = Math.min(0, o.w);
      const minY = Math.min(0, o.h);
      const w = Math.abs(o.w);
      const h = Math.abs(o.h);
      const sx = -minX;
      const sy = -minY;
      const ex = sx + o.w;
      const ey = sy + o.h;
      return (
        <div
          onPointerDown={handle}
          data-canvas-object-kind={o.type}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x + minX}px, ${o.y + minY}px, 0)`,
            width: w || 1,
            height: h || 1,
            cursor: o.locked ? "default" : "move",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <svg width="100%" height="100%" overflow="visible">
            <line
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              stroke={o.stroke}
              strokeWidth={o.strokeWidth}
              strokeDasharray={o.dashed ? "6 4" : undefined}
            />
            {o.type === "arrow" && (
              <polygon
                points={arrowheadPoints(
                  { x: ex, y: ey },
                  { x: o.w, y: o.h },
                  Math.max(8, o.strokeWidth * 3)
                )}
                fill={o.stroke}
              />
            )}
          </svg>
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "freehand": {
      // We draw freehand objects as their own SVG path inside a div that
      // covers the object's bbox in world coords. Points are world-coords;
      // shift them into the local svg coord system. Strokes without a
      // `pressures` array (legacy / mouse / non-pressure touch) render
      // as a polyline; strokes WITH `pressures` (stylus) go through
      // perfect-freehand so the contour tapers with pen pressure.
      const { points } = o;
      if (points.length < 4) return null;
      const pressures = o.pressures;
      const hasPressures = Array.isArray(pressures) && pressures.length === points.length / 2;

      let svgInner: React.ReactNode;
      if (hasPressures) {
        // Interleave the parallel pressures with x,y pairs to feed
        // perfect-freehand's stride-3 expectation, translating into the
        // object's local coord system in the same pass.
        const local: number[] = [];
        for (let i = 0, p = 0; i + 1 < points.length; i += 2, p += 1) {
          local.push(points[i] - o.x, points[i + 1] - o.y, pressures![p]);
        }
        // perfect-freehand's `size` is the width at default pressure 0.5
        // (with default thinning 0.5). So `size = strokeWidth` produces a
        // committed path whose mid-pressure visual width matches the
        // existing strokeWidth polyline — no jump on pointer-up.
        const d = flatPointsToPath(local, { size: o.strokeWidth }, true);
        svgInner = <path d={d} fill={o.stroke} stroke="none" />;
      } else {
        const d = points
          .map((v, i) => (i % 2 === 0 ? `${i === 0 ? "M" : "L"}${v - o.x}` : ` ${v - o.y}`))
          .join("");
        svgInner = (
          <path
            d={d}
            fill="none"
            stroke={o.stroke}
            strokeWidth={o.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      }

      return (
        <div
          onPointerDown={handle}
          data-canvas-object-kind="freehand"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)`,
            width: o.w || 1,
            height: o.h || 1,
            cursor: o.locked ? "default" : "move",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <svg width="100%" height="100%" overflow="visible">
            {svgInner}
          </svg>
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "image": {
      // SECURITY: o.src is user-controlled (paste, cross-tool import,
      // realtime patch). Block anything outside the http(s)/data:image
      // whitelist. Modern browsers don't fire JS from `<img src>` for
      // javascript: URLs, but stripping defensively guards against
      // future renderer changes (iframe/object) reusing this code path.
      const safeSrc = safeImageSrc(o.src);
      return (
        <div
          onPointerDown={handle}
          data-canvas-object-kind="image"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            cursor: o.locked ? "default" : "move",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <img
            src={safeSrc}
            alt={o.alt ?? ""}
            style={{
              width: "100%",
              height: "100%",
              objectFit: o.fit === "cover" ? "cover" : "contain",
              display: "block",
              pointerEvents: "none",
            }}
            draggable={false}
          />
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "embed": {
      const iframeSrc = embedIframeUrl(o.src ?? "", o.kind);
      // Compute per-host sandbox tier from the resolved iframe src
      // (NOT the user-typed URL) — embedIframeUrl already normalises
      // figma.com / youtube.com / loom.com to known embed endpoints,
      // so we read the host off the result for accurate routing.
      let iframeHost = "";
      if (iframeSrc) {
        try {
          iframeHost = new URL(iframeSrc).hostname;
        } catch {
          iframeHost = "";
        }
      }
      const sandboxAttr = iframeSandboxFor(iframeHost);
      return (
        <div
          onPointerDown={handle}
          data-canvas-object-kind="embed"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)`,
            width: o.w,
            height: o.h,
            background: "#1e293b",
            border: "1px solid #475569",
            color: "#94a3b8",
            fontSize: 12,
            cursor: o.locked ? "default" : "move",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            overflow: "hidden",
            ...selectionStyle,
          }}
        >
          {iframeSrc ? (
            <>
              <iframe
                src={iframeSrc}
                title={`${o.kind} embed`}
                // SECURITY: sandbox tier is resolved per-host via
                // `iframeSandboxFor`. Most hosts (YouTube, Google Docs,
                // generic embeds) get the strict tier. Figma + Loom
                // need `allow-same-origin` to retain signed-in state;
                // since those hosts run in their OWN third-party
                // origin, the spec's "scripts + same-origin from the
                // SAME origin lets the iframe drop its sandbox"
                // footgun does NOT apply.
                sandbox={sandboxAttr}
                allow="autoplay; fullscreen; picture-in-picture"
                referrerPolicy="no-referrer"
                loading="lazy"
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  // Block pointer events when locked or when this is
                  // not the selected object — otherwise the iframe
                  // steals every drag attempt.
                  pointerEvents: selected ? "auto" : "none",
                }}
              />
              {/* Click-shield overlay when not selected so the user
                  can still drag/select the embed via its outer div
                  without iframe-captured pointers. */}
              {!selected && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    inset: 0,
                    cursor: o.locked ? "default" : "move",
                  }}
                />
              )}
            </>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: "100%",
                padding: 8,
                textAlign: "center",
              }}
            >
              {o.kind}: {(o.src ?? "").slice(0, 60) || "(no source)"}
            </div>
          )}
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

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
      // Kanban frames render like Frame but with column dividers; we
      // reuse the existing frame logic by short-circuiting here.
      return (
        <div
          data-canvas-object-kind="kanban"
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)`,
            width: o.w,
            height: o.h,
            border: "1.5px dashed #60a5fa",
            borderRadius: 8,
            background: "rgba(96, 165, 250, 0.05)",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -22,
              left: 6,
              fontSize: 12,
              color: "#60a5fa",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              background: "#0b0f17",
              padding: "1px 6px",
              borderRadius: 3,
            }}
          >
            ▣ {o.label}
          </div>
          {/* Column dividers — visual cue for users to drop cards into. */}
          {o.columns.map((_col, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: (i / o.columns.length) * o.w,
                    top: 0,
                    width: 1,
                    height: o.h,
                    background: "rgba(96, 165, 250, 0.3)",
                  }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  left: (i / o.columns.length) * o.w + 6,
                  top: 8,
                  fontSize: 10,
                  color: "#60a5fa",
                  fontFamily: "ui-sans-serif, system-ui, sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  pointerEvents: "none",
                }}
              >
                {(o.columnLabels?.[i] ?? o.columns[i]).replace(/_/g, " ")}
              </div>
            </React.Fragment>
          ))}
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );

    default:
      // `connector` is rendered separately in a single SVG layer covering
      // the whole canvas — connectors reference other objects' positions,
      // so it's easier to draw them once with all positions known.
      return null;
  }
}

export const ObjectRenderer = memo(ObjectRendererImpl);
