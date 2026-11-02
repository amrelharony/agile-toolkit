"use client";

import {
  Database,
  Server,
  Cloud,
  User,
  Cog,
  Diamond as DiamondIcon,
  ListOrdered,
  Globe,
  Monitor,
  Smartphone,
  Container,
  Lock,
  Workflow,
  GitMerge,
  Layers,
  Mail,
  type LucideIcon,
} from "lucide-react";
import type { WhiteboardDiagramShape, WhiteboardObject } from "@/lib/stores/workspace-types";

/**
 * Registry of named diagram shapes. Each kind has:
 *   - `label`: human-readable name (used by the picker)
 *   - `icon`: lucide icon component rendered inside the box
 *   - `tint`: subtle accent colour for border + icon
 *
 * Extending: add a row here, no other code needs to change. The
 * picker iterates this object, the renderer looks up by kind.
 */
export const DIAGRAM_SHAPE_KINDS: Record<
  string,
  { label: string; icon: LucideIcon; tint: string }
> = {
  database: { label: "Database", icon: Database, tint: "#60a5fa" },
  server: { label: "Server", icon: Server, tint: "#a78bfa" },
  cloud: { label: "Cloud", icon: Cloud, tint: "#22d3ee" },
  user: { label: "User", icon: User, tint: "#34d399" },
  process: { label: "Process", icon: Cog, tint: "#f59e0b" },
  decision: { label: "Decision", icon: DiamondIcon, tint: "#fb7185" },
  queue: { label: "Queue", icon: ListOrdered, tint: "#f472b6" },
  api: { label: "API", icon: Globe, tint: "#94a3b8" },
  // Round 2 additions — more architecture-diagram vocabulary
  client: { label: "Client", icon: Monitor, tint: "#fcd34d" },
  mobile: { label: "Mobile", icon: Smartphone, tint: "#fb923c" },
  container: { label: "Container", icon: Container, tint: "#38bdf8" },
  auth: { label: "Auth", icon: Lock, tint: "#ef4444" },
  workflow: { label: "Workflow", icon: Workflow, tint: "#a3e635" },
  gateway: { label: "Gateway", icon: GitMerge, tint: "#fbbf24" },
  cache: { label: "Cache", icon: Layers, tint: "#10b981" },
  notification: { label: "Notification", icon: Mail, tint: "#c084fc" },
};

/**
 * Renders a named diagram shape as a styled box: icon at top, label
 * below. The box uses the registry's `tint` for the border and
 * icon colour so each shape kind reads at a glance from across the
 * canvas (a 40px-wide AWS-S3 thumbnail looks like S3, not "generic
 * box #4").
 *
 * Falls back to a plain bordered box with the kind string if the
 * kind isn't in the registry — defensive in case a peer broadcasts
 * a shape we don't recognise yet.
 */
export function DiagramShape({
  object,
  selected,
  editing,
  onPointerDown,
  onDoubleClick,
  onCommitEdit,
}: {
  object: WhiteboardDiagramShape;
  selected: boolean;
  editing: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
  onCommitEdit?: (text: string) => void;
}) {
  const def = DIAGRAM_SHAPE_KINDS[object.kind];
  const Icon = def?.icon;
  const tint = object.stroke ?? def?.tint ?? "#94a3b8";
  const fill = object.fill ?? "rgba(15, 23, 42, 0.85)";
  // Icon dimension scales with shape height; clamped so a very
  // small or very large shape still reads cleanly.
  const iconSize = Math.max(20, Math.min(48, Math.floor(object.h * 0.4)));
  return (
    // Pointer surface only: keyboard users select objects with Tab and
    // edit with Enter on the board (role="application"), which announces
    // the selection — see use-contextual-shortcuts / whiteboard-canvas.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      onPointerDown={editing ? undefined : onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
      data-canvas-object-kind="diagramShape"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${object.x}px, ${object.y}px, 0)${object.rotation ? ` rotate(${object.rotation}deg)` : ""}`,
        width: object.w,
        height: object.h,
        background: fill,
        border: `${selected ? 2 : 1.5}px solid ${selected ? "var(--accent)" : tint}`,
        borderRadius: 8,
        boxShadow: selected
          ? "0 0 12px color-mix(in srgb, var(--accent) 40%, transparent)"
          : "0 1px 3px rgba(0,0,0,0.3)",
        color: "#e5e7eb",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 11,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: 6,
        cursor: editing ? "text" : object.locked ? "default" : "move",
        zIndex: object.z,
        opacity: object.locked ? 0.85 : 1,
        userSelect: editing ? "text" : "none",
        boxSizing: "border-box",
      }}
    >
      {Icon ? (
        <Icon
          width={iconSize}
          height={iconSize}
          style={{ color: tint, flexShrink: 0 }}
          aria-hidden="true"
        />
      ) : (
        <span style={{ fontSize: 10, color: tint, fontFamily: "ui-monospace, monospace" }}>
          {object.kind}
        </span>
      )}
      {editing ? (
        <ShapeLabelEditor initial={object.label} onCommit={(t) => onCommitEdit?.(t)} />
      ) : (
        <div
          style={{
            textAlign: "center",
            width: "100%",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.2,
          }}
        >
          {object.label || <span style={{ opacity: 0.45 }}>{def?.label ?? object.kind}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Inline label editor — same pattern as sticky/text but trimmed for
 * a single-line label. Single-line because diagram shapes are
 * usually icons + a short caption; multi-line bloats the diagram.
 */
function ShapeLabelEditor({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (text: string) => void;
}) {
  return (
    <input
      type="text"
      aria-label="Diagram shape label"
      autoFocus
      defaultValue={initial}
      maxLength={120}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          onCommit((e.currentTarget as HTMLInputElement).value);
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        textAlign: "center",
        background: "transparent",
        border: "none",
        outline: "1px solid var(--accent)",
        outlineOffset: -1,
        borderRadius: 4,
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        padding: "1px 4px",
      }}
    />
  );
}

/**
 * Default-size helper for a new diagram shape — exposed so the
 * picker / addObjectAt path size new shapes consistently.
 */
export const DIAGRAM_SHAPE_DEFAULT = { w: 120, h: 88 } as const;

/** Type-narrowing helper used by the renderer dispatch. */
export function isDiagramShape(o: WhiteboardObject): o is WhiteboardDiagramShape {
  return o.type === "diagramShape";
}
