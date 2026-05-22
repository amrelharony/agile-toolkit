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
  CreditCard,
  Timer as TimerIcon,
  Vote,
  Columns,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasTool } from "../use-canvas-store";

interface ToolDef {
  id: CanvasTool;
  label: string;
  icon: typeof MousePointer2;
  shortcut: string;
}

/**
 * Tool groups for the left toolbar. A hairline separator renders between
 * groups so the user can chunk the 18 tools by purpose:
 *
 *   1. Cursor — Select + Pan (modes, not creation tools)
 *   2. Notes — Sticky + Card (the two text-bearing primitives)
 *   3. Shapes — Rectangle / Ellipse / Diamond / Triangle
 *   4. Lines — Line / Arrow / Connector
 *   5. Text & Pen — Text / Pen
 *   6. Containers — Frame / Kanban
 *   7. Interactive — Timer / Vote / Comment
 *
 * Without the grouping every tool sat in a single 18-deep column with
 * no visual hierarchy, making it harder to find a known tool quickly
 * and creating decision overload for new users.
 */
const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: "select", label: "Select", icon: MousePointer2, shortcut: "V" },
    { id: "hand",   label: "Pan",    icon: Hand,          shortcut: "H" },
  ],
  [
    { id: "sticky", label: "Sticky", icon: StickyNote,    shortcut: "N" },
    { id: "card",   label: "Card",   icon: CreditCard,    shortcut: "K" },
  ],
  [
    { id: "rect",     label: "Rectangle", icon: Square,   shortcut: "R" },
    { id: "ellipse",  label: "Ellipse",   icon: Circle,   shortcut: "O" },
    { id: "diamond",  label: "Diamond",   icon: Diamond,  shortcut: "" },
    { id: "triangle", label: "Triangle",  icon: Triangle, shortcut: "" },
  ],
  [
    { id: "line",      label: "Line",      icon: Slash,      shortcut: "L" },
    { id: "arrow",     label: "Arrow",     icon: ArrowRight, shortcut: "A" },
    { id: "connector", label: "Connector", icon: GitBranch,  shortcut: "C" },
  ],
  [
    { id: "text",     label: "Text", icon: Type,    shortcut: "T" },
    { id: "freehand", label: "Pen",  icon: PenTool, shortcut: "P" },
  ],
  [
    { id: "frame",  label: "Frame",  icon: Frame,   shortcut: "F" },
    { id: "kanban", label: "Kanban", icon: Columns, shortcut: "" },
  ],
  [
    { id: "timer",   label: "Timer",   icon: TimerIcon,     shortcut: "" },
    { id: "voting",  label: "Vote",    icon: Vote,          shortcut: "" },
    { id: "comment", label: "Comment", icon: MessageCircle, shortcut: "" },
  ],
];

export function ToolbarLeft() {
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);

  return (
    <div
      // Responsive layout:
      //   - Top-anchored with a max-height ceiling (was top:50% +
      //     -translate-y-50%) so the 18-tool column never overflows
      //     the canvas viewport on portrait phones (375x667 viewports
      //     can't host a 648px column centred-vertically — the bottom
      //     tools would clip below the canvas bottom)
      //   - overflow-y-auto so any remaining overflow scrolls instead
      //     of clipping silently
      //   - overscroll-contain so toolbar scrolling doesn't bubble out
      //     to the canvas pan, which would cause a confusing combined
      //     gesture on touch devices
      //   - thin custom scrollbar so the rail doesn't look stuffy
      //     when scrolling
      // Also: 32x32 buttons on narrow viewports (<sm) and 36x36 on
      // larger so touch users get a 44px-class hit area when you
      // include the toolbar padding.
      className="absolute left-2 sm:left-3 top-2 sm:top-3 bottom-2 sm:bottom-auto sm:max-h-[calc(100%-1.5rem)] flex flex-col gap-0.5 bg-surface/95 border border-border rounded-lg p-1 shadow-lg backdrop-blur-sm z-10 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
      role="toolbar"
      aria-label="Canvas tools"
      // PNG export filters out anything carrying this attribute so the
      // exported image shows the board, not the toolbar overlay.
      data-canvas-export-ignore="true"
    >
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} className="contents">
          {gi > 0 && (
            <div
              aria-hidden="true"
              className="h-px bg-border/50 mx-1.5 my-1"
            />
          )}
          {group.map((t) => {
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
                // Hit area scales with viewport: 36x36 on desktop, 40x40
                // on touch (sm:w-9) so finger taps land reliably.
                // shrink-0 protects the row from squashing when the
                // toolbar's scrollable height fights for space.
                className={cn(
                  "w-10 h-10 sm:w-9 sm:h-9 rounded-md flex items-center justify-center transition-colors shrink-0",
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
      ))}
    </div>
  );
}
