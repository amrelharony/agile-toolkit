"use client";

/**
 * Frame object view. Extracted verbatim from object-renderer's `case "frame"` —
 * a dashed container with an editable label tab and, when selected, the
 * speaker-notes affordance (wired via onMutate).
 */

import React from "react";
import type { WhiteboardFrame, WhiteboardObject } from "@/lib/stores/workspace-types";
import { InlineEditor, LockBadge, FramePresenterNotesAffordance } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function FrameObject({
  object: o,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onCommitEdit,
  onMutate,
}: ObjectViewBaseProps & {
  object: WhiteboardFrame;
  onMutate?: (id: string, patch: Partial<WhiteboardObject>) => void;
}) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const dblClick = () => onDoubleClick?.(o.id);
  const commitEdit = (text: string) => onCommitEdit?.(o.id, text);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

  return (
    // Pointer surface only: keyboard users select objects with Tab and
    // edit with Enter on the board (role="application"), which announces
    // the selection — see use-contextual-shortcuts / whiteboard-canvas.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
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
            label="Frame name"
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
          onCommit={(text) => onMutate(o.id, { presenterNotes: text } as Partial<WhiteboardObject>)}
        />
      )}
    </div>
  );
}
