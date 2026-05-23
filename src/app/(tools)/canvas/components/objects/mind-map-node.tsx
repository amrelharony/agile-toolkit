"use client";

import { useEffect, useRef } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { WhiteboardMindMapNode, WhiteboardObject } from "@/lib/stores/workspace-types";

/**
 * Rendered as a rounded "bubble" with the node's text centered.
 * Root nodes (no parentNodeId) render with a slightly heavier border
 * + filled background tint so they read as the anchor of the map.
 *
 * Inline edit reuses the same textarea + IME pattern as the original
 * sticky InlineEditor — no Tiptap here yet because mind-map nodes are
 * single-line labels in practice and the extra weight isn't worth it.
 */
export type MindMapAction = "child" | "sibling" | "promote";

export function MindMapNode({
  object,
  selected,
  editing,
  hasChildren,
  onPointerDown,
  onDoubleClick,
  onCommitEdit,
  onStructuralAction,
  onMutate,
}: {
  object: WhiteboardMindMapNode;
  selected: boolean;
  editing: boolean;
  /** True when this node has at least one child mind-map node. The
   * collapse toggle only renders when true (a childless leaf has
   * nothing to collapse). */
  hasChildren: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  onCommitEdit?: (text: string) => void;
  /** Called from inside the inline editor when the user presses Tab
   * (child), Enter (sibling), or Shift+Tab (promote). The action's
   * text param is whatever was in the editor at the time so the
   * parent can commit-and-act in one undo step. */
  onStructuralAction?: (action: MindMapAction, committedText: string) => void;
  /** Patch the node's own fields (e.g. collapse toggle). Used for
   * non-structural edits that the parent doesn't need to coordinate. */
  onMutate?: (patch: Partial<WhiteboardObject>) => void;
}) {
  const isRoot = !object.parentNodeId;
  const accent = object.color ?? "#00f0ff";
  const border = selected ? "#00f0ff" : (isRoot ? accent : "rgba(148, 163, 184, 0.6)");
  const bg = isRoot ? "rgba(0, 240, 255, 0.12)" : "rgba(15, 23, 42, 0.95)";

  return (
    <div
      onPointerDown={editing ? undefined : onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
      data-canvas-object-kind="mindMapNode"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${object.x}px, ${object.y}px, 0)${object.rotation ? ` rotate(${object.rotation}deg)` : ""}`,
        width: object.w,
        height: object.h,
        background: bg,
        border: `${selected ? 2 : isRoot ? 2 : 1}px solid ${border}`,
        borderRadius: 10,
        boxShadow: selected
          ? "0 0 12px rgba(0,240,255,0.4)"
          : isRoot
            ? "0 2px 8px rgba(0,0,0,0.4)"
            : "0 1px 3px rgba(0,0,0,0.3)",
        color: "#e5e7eb",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: isRoot ? 14 : 12,
        fontWeight: isRoot ? 600 : 400,
        padding: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        cursor: editing ? "text" : (object.locked ? "default" : "move"),
        zIndex: object.z,
        opacity: object.locked ? 0.85 : 1,
        userSelect: editing ? "text" : "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {editing ? (
        <NodeEditor
          initial={object.text}
          onCommit={(t) => onCommitEdit?.(t)}
          onStructuralAction={onStructuralAction}
        />
      ) : (
        object.text || <span style={{ opacity: 0.4 }}>{isRoot ? "Topic" : "Idea"}</span>
      )}
      {/* Collapse/expand toggle — only visible when selected + has
          children. Sits on the right edge so a left-radiating tree
          eventually still uses the same convention (caller renders
          edges from this node rightward today). */}
      {!editing && hasChildren && selected && onMutate && (
        <button
          type="button"
          aria-label={object.collapsed ? "Expand children" : "Collapse children"}
          title={object.collapsed ? "Expand" : "Collapse"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMutate({ collapsed: !object.collapsed } as Partial<WhiteboardObject>);
          }}
          style={{
            position: "absolute",
            top: -10,
            right: -10,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "rgba(11,15,23,0.95)",
            border: "1px solid #00f0ff",
            color: "#00f0ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 2,
            boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }}
        >
          {object.collapsed ? (
            <ChevronRight width={12} height={12} aria-hidden="true" />
          ) : (
            <ChevronDown width={12} height={12} aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Single-line inline editor for a mind-map node label. Reuses the IME
 * + commit semantics from the original sticky InlineEditor: focus +
 * select on mount, Enter / Esc / blur commit. Shift+Enter inserts a
 * newline so multi-line nodes are possible but not the default.
 */
function NodeEditor({
  initial,
  onCommit,
  onStructuralAction,
}: {
  initial: string;
  onCommit: (text: string) => void;
  onStructuralAction?: (action: MindMapAction, committedText: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const valueRef = useRef(initial);
  // Latch: once a structural action fires (Tab/Enter/Shift+Tab),
  // skip the onBlur commit. Without this guard, the upcoming
  // setEditingObjectId(null) blurs the textarea, which fires
  // onBlur, which calls onCommit AGAIN — producing a second
  // text-update + a duplicate undo entry.
  const structuralFiredRef = useRef(false);
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      maxLength={500}
      defaultValue={initial}
      onChange={(e) => {
        const native = e.nativeEvent as InputEvent;
        if (native && native.isComposing) return;
        valueRef.current = e.target.value;
      }}
      onCompositionEnd={(e) => { valueRef.current = (e.target as HTMLTextAreaElement).value; }}
      onBlur={() => {
        if (structuralFiredRef.current) return;
        onCommit(valueRef.current);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        // Mind-map structural keys take priority over the plain
        // commit path when a handler is supplied (i.e. we're inside
        // a mind-map node, not a generic sticky/text edit).
        if (onStructuralAction) {
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            structuralFiredRef.current = true;
            onStructuralAction("child", valueRef.current);
            e.stopPropagation();
            return;
          }
          if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            structuralFiredRef.current = true;
            onStructuralAction("promote", valueRef.current);
            e.stopPropagation();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            structuralFiredRef.current = true;
            onStructuralAction("sibling", valueRef.current);
            e.stopPropagation();
            return;
          }
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit(valueRef.current);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCommit(valueRef.current);
        }
        // Stop bubble so canvas-level shortcuts (V, N, R, …) don't
        // fire while the user is typing letters that happen to be
        // tool keys.
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        height: "100%",
        background: "transparent",
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        fontWeight: "inherit",
        textAlign: "inherit",
        border: "none",
        outline: "2px solid #00f0ff",
        outlineOffset: -1,
        borderRadius: 6,
        padding: 4,
        boxSizing: "border-box",
        resize: "none",
      }}
    />
  );
}
