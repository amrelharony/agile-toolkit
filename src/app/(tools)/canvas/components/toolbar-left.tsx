"use client";

import {
  MousePointer2,
  StickyNote,
  Square,
  Circle,
  Diamond,
  Triangle,
  Slash,
  ArrowRight,
  Type,
  PenTool,
  GitBranch,
  Frame,
  Hand,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasTool } from "../use-canvas-store";

interface ToolDef {
  id: CanvasTool;
  label: string;
  icon: typeof MousePointer2;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { id: "select",   label: "Select",      icon: MousePointer2, shortcut: "V" },
  { id: "hand",     label: "Pan",         icon: Hand,          shortcut: "H" },
  { id: "sticky",   label: "Sticky",      icon: StickyNote,    shortcut: "N" },
  { id: "rect",     label: "Rectangle",   icon: Square,        shortcut: "R" },
  { id: "ellipse",  label: "Ellipse",     icon: Circle,        shortcut: "O" },
  { id: "diamond",  label: "Diamond",     icon: Diamond,       shortcut: "" },
  { id: "triangle", label: "Triangle",    icon: Triangle,      shortcut: "" },
  { id: "line",     label: "Line",        icon: Slash,         shortcut: "L" },
  { id: "arrow",    label: "Arrow",       icon: ArrowRight,    shortcut: "A" },
  { id: "text",     label: "Text",        icon: Type,          shortcut: "T" },
  { id: "freehand", label: "Pen",         icon: PenTool,       shortcut: "P" },
  { id: "connector",label: "Connector",   icon: GitBranch,     shortcut: "C" },
  { id: "frame",    label: "Frame",       icon: Frame,         shortcut: "F" },
  { id: "comment",  label: "Comment",     icon: MessageCircle, shortcut: "" },
];

export function ToolbarLeft() {
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);

  return (
    <div
      className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-surface/95 border border-border rounded-lg p-1 shadow-lg backdrop-blur-sm z-10"
      role="toolbar"
      aria-label="Canvas tools"
      // PNG export filters out anything carrying this attribute so the
      // exported image shows the board, not the toolbar overlay.
      data-canvas-export-ignore="true"
    >
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const active = tool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
            aria-label={t.label}
            aria-pressed={active}
            className={cn(
              "w-9 h-9 rounded-md flex items-center justify-center transition-colors",
              active
                ? "bg-accent/20 text-accent"
                : "text-sub hover:text-text hover:bg-surface-deep",
            )}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
