"use client";

/**
 * Sticky-note object view. Extracted verbatim from object-renderer's
 * `case "sticky"`. Font auto-scales with the shorter dimension unless the user
 * set an explicit fontSize.
 */

import React from "react";
import type { WhiteboardSticky } from "@/lib/stores/workspace-types";
import { TiptapInlineEditor } from "../tiptap-inline-editor";
import { isRichHtml } from "../../lib/object-render-utils";
import { RichContent, LockBadge } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function StickyObject({
  object: o,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onCommitEdit,
}: ObjectViewBaseProps & { object: WhiteboardSticky }) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const dblClick = () => onDoubleClick?.(o.id);
  const commitEdit = (text: string) => onCommitEdit?.(o.id, text);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

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
    // Pointer surface only: keyboard users select objects with Tab and
    // edit with Enter on the board (role="application"), which announces
    // the selection — see use-contextual-shortcuts / whiteboard-canvas.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
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
          label="Sticky note text"
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
