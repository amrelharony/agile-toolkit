"use client";

/**
 * Card object (Phase 26) — a structured "ticket" on the canvas.
 *
 * Distinct from a sticky: a card has title + description + assignee +
 * due date + points + status. When `sourceRef.tool === "backlog"`,
 * this card is a live projection of the corresponding `Story` in
 * the workspace store. The canvas's cross-tool-sync layer handles
 * the bidirectional update on title/description/assignee/etc.; we
 * just render and provide inline-edit for the title.
 */

import { memo, useEffect, useRef } from "react";
import { User, Calendar, Tag as TagIcon } from "lucide-react";
import type { WhiteboardCard } from "@/lib/stores/workspace-types";

interface CardObjectProps {
  object: WhiteboardCard;
  selected: boolean;
  editing: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  onCommitEdit?: (text: string) => void;
}

function CardObjectImpl({ object: o, selected, editing, onPointerDown, onDoubleClick, onCommitEdit }: CardObjectProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.setSelectionRange(0, taRef.current.value.length);
    }
  }, [editing]);

  const accentColor = o.color ?? "#00f0ff";
  const formatDate = (d?: string) => {
    if (!d) return null;
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch { return null; }
  };

  return (
    <div
      onPointerDown={editing ? undefined : onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
        width: o.w,
        height: o.h,
        background: "#1e293b",
        borderLeft: `4px solid ${accentColor}`,
        borderTop: "1px solid #475569",
        borderRight: "1px solid #475569",
        borderBottom: "1px solid #475569",
        borderRadius: 6,
        boxShadow: selected
          ? "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)"
          : "0 1px 3px rgba(0,0,0,0.3)",
        cursor: editing ? "text" : o.locked ? "default" : "move",
        zIndex: o.z,
        opacity: o.locked ? 0.85 : 1,
        userSelect: editing ? "text" : "none",
        display: "flex",
        flexDirection: "column",
        padding: 8,
        boxSizing: "border-box",
        color: "#e5e7eb",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      {editing ? (
        <textarea
          ref={taRef}
          defaultValue={o.title}
          onBlur={(e) => onCommitEdit?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onCommitEdit?.((e.target as HTMLTextAreaElement).value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCommitEdit?.((e.target as HTMLTextAreaElement).value);
            }
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            inset: 0,
            padding: 8,
            background: "transparent",
            border: "none",
            outline: "2px solid #00f0ff",
            color: "#e5e7eb",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            resize: "none",
            boxSizing: "border-box",
          }}
        />
      ) : (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", marginBottom: 4, lineHeight: 1.3, wordWrap: "break-word" }}>
            {o.title || <span style={{ opacity: 0.4 }}>Card title</span>}
          </div>
          {o.description && (
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
              {o.description}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: "auto", fontSize: 10, color: "#94a3b8" }}>
            {o.assignee && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 10, background: "rgba(0,240,255,0.1)" }}>
                <User style={{ width: 9, height: 9 }} />
                {o.assignee}
              </span>
            )}
            {o.due && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 10, background: "rgba(245,158,11,0.1)" }}>
                <Calendar style={{ width: 9, height: 9 }} />
                {formatDate(o.due)}
              </span>
            )}
            {typeof o.points === "number" && (
              <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 6px", borderRadius: 10, background: "rgba(167,139,250,0.15)", color: "#c4b5fd", fontWeight: 700 }}>
                {o.points}pt
              </span>
            )}
            {o.status && (
              <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 6px", borderRadius: 10, background: "rgba(148,163,184,0.15)" }}>
                {o.status.replace("_", " ")}
              </span>
            )}
            {o.tags?.slice(0, 3).map((tag) => (
              <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 10, background: "rgba(52,211,153,0.1)", color: "#6ee7b7" }}>
                <TagIcon style={{ width: 9, height: 9 }} />
                {tag}
              </span>
            ))}
          </div>
          {o.sourceRef && (
            <div
              aria-label={`Linked to ${o.sourceRef.tool}`}
              title={`Linked to ${o.sourceRef.tool}`}
              style={{ position: "absolute", top: 4, right: 4, fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}
            >
              ↳ {o.sourceRef.tool}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const CardObject = memo(CardObjectImpl);
