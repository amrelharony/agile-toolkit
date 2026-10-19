"use client";

/**
 * Shape object view (rect / ellipse / diamond / triangle). Extracted verbatim
 * from object-renderer's shape case — renders the SVG primitive plus optional
 * centered inner text (static or InlineEditor while editing).
 */

import React from "react";
import type { WhiteboardShape } from "@/lib/stores/workspace-types";
import { InlineEditor, LockBadge } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function ShapeObject({
  object: o,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onCommitEdit,
}: ObjectViewBaseProps & { object: WhiteboardShape }) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const dblClick = () => onDoubleClick?.(o.id);
  const commitEdit = (text: string) => onCommitEdit?.(o.id, text);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

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
    // Pointer surface only: keyboard users select objects with Tab and
    // edit with Enter on the board (role="application"), which announces
    // the selection — see use-contextual-shortcuts / whiteboard-canvas.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
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
            label="Shape text"
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
