"use client";

/**
 * Kanban-frame object view. Extracted verbatim from object-renderer's
 * `case "kanban"` — a dashed frame with column dividers + labels.
 */

import React from "react";
import type { WhiteboardKanbanFrame } from "@/lib/stores/workspace-types";
import { LockBadge } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function KanbanObject({
  object: o,
  selected,
  onPointerDown,
}: ObjectViewBaseProps & { object: WhiteboardKanbanFrame }) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

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
}
