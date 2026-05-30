"use client";

/**
 * Free text object view. Extracted verbatim from object-renderer's
 * `case "text"` — rich-text aware, with a Tiptap editor while editing.
 */

import React from "react";
import type { WhiteboardText } from "@/lib/stores/workspace-types";
import { TiptapInlineEditor } from "../tiptap-inline-editor";
import { isRichHtml } from "../../lib/object-render-utils";
import { RichContent, LockBadge } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function TextObject({
  object: o,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onCommitEdit,
}: ObjectViewBaseProps & { object: WhiteboardText }) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const dblClick = () => onDoubleClick?.(o.id);
  const commitEdit = (text: string) => onCommitEdit?.(o.id, text);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

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
}
