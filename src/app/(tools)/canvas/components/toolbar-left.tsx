"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  Table as TableIcon,
  Network,
  Boxes,
} from "lucide-react";
import { DiagramShapePicker } from "./diagram-shape-picker";
import { cn } from "@/lib/utils";
import { keepBoardFocus } from "@/lib/whiteboard/keyboard";
import { useCanvasStore, type CanvasTool } from "../use-canvas-store";
import {
  COARSE_SCROLL_FADE,
  scrollFadeMask,
  scrollFadeStyle,
  useScrollEdges,
} from "../hooks/use-scroll-edges";

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
    { id: "hand", label: "Pan", icon: Hand, shortcut: "H" },
  ],
  [
    { id: "sticky", label: "Sticky", icon: StickyNote, shortcut: "N" },
    { id: "card", label: "Card", icon: CreditCard, shortcut: "K" },
  ],
  [
    { id: "rect", label: "Rectangle", icon: Square, shortcut: "R" },
    { id: "ellipse", label: "Ellipse", icon: Circle, shortcut: "O" },
    { id: "diamond", label: "Diamond", icon: Diamond, shortcut: "" },
    { id: "triangle", label: "Triangle", icon: Triangle, shortcut: "" },
  ],
  [
    { id: "line", label: "Line", icon: Slash, shortcut: "L" },
    { id: "arrow", label: "Arrow", icon: ArrowRight, shortcut: "A" },
    { id: "connector", label: "Connector", icon: GitBranch, shortcut: "C" },
  ],
  [
    { id: "text", label: "Text", icon: Type, shortcut: "T" },
    { id: "freehand", label: "Pen", icon: PenTool, shortcut: "P" },
  ],
  [
    { id: "frame", label: "Frame", icon: Frame, shortcut: "F" },
    { id: "kanban", label: "Kanban", icon: Columns, shortcut: "" },
    { id: "table", label: "Table", icon: TableIcon, shortcut: "" },
    { id: "mindMap", label: "Mind map", icon: Network, shortcut: "" },
  ],
  [
    { id: "timer", label: "Timer", icon: TimerIcon, shortcut: "" },
    { id: "voting", label: "Vote", icon: Vote, shortcut: "" },
    { id: "comment", label: "Comment", icon: MessageCircle, shortcut: "" },
  ],
];

/**
 * Rail top below `sm` when the board toolbar (ToolbarTop) shares the
 * stage: that bar starts at the stage's left edge at `top-2` (it stops
 * short of the corner voice button) and is 54 px tall on touch
 * (44 px controls + padding + border), so the rail starts under it
 * (8 + 54 + a 6 px gap = 68 px = 4.25rem). From `sm` up the board
 * toolbar is narrowed to clear the rail, and both sit at `top-3`.
 */
export const RAIL_TOP_UNDER_BOARD_BAR = "top-[4.25rem] sm:top-3";
const RAIL_TOP_ALONE = "top-2 sm:top-3";

interface ToolbarLeftProps {
  /** The board toolbar shares the stage (the /canvas page; the guest
   * board has none). Below `sm` the rail then starts under it, so that
   * bar never covers Select. */
  clearBoardBar?: boolean;
}

export function ToolbarLeft({ clearBoardBar = false }: ToolbarLeftProps = {}) {
  const tool = useCanvasStore((s) => s.tool);
  const setTool = useCanvasStore((s) => s.setTool);
  // Diagram picker — anchored on the Diagrams button. We capture the
  // button's bounding rect on open so the popover renders next to it
  // (rather than at a fixed viewport position).
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const diagramBtnRef = useRef<HTMLButtonElement | null>(null);
  // The picker takes focus when it opens (it is portalled to the end of
  // <body>, far from this button in Tab order). When it closes with focus
  // inside (Escape, or a shape picked), focus comes back to the Diagrams
  // button; a press elsewhere moves focus on by itself.
  const pickerHostRef = useRef<HTMLDivElement | null>(null);
  const closePicker = useCallback(() => {
    const active = document.activeElement;
    const focusInPicker = !!active && !!pickerHostRef.current?.contains(active);
    setPickerAnchor(null);
    if (focusInPicker) diagramBtnRef.current?.focus({ preventScroll: true });
  }, []);
  // The 22-tool rail scrolls on phones (about 8 tools fit at 360x640)
  // and touch browsers hide its scrollbar, so a faded end shows there
  // is more above / below.
  const railRef = useRef<HTMLDivElement | null>(null);
  const fadeMask = scrollFadeMask("y", useScrollEdges(railRef, "y"));

  return (
    <div
      ref={railRef}
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
      className={cn(
        "absolute left-2 sm:left-3 bottom-2 sm:bottom-auto sm:max-h-[calc(100%-1.5rem)] flex flex-col gap-0.5 bg-surface/95 border border-border rounded-lg p-1 shadow-lg backdrop-blur-sm z-10 overflow-y-auto overscroll-contain [scrollbar-width:thin]",
        clearBoardBar ? RAIL_TOP_UNDER_BOARD_BAR : RAIL_TOP_ALONE,
        COARSE_SCROLL_FADE
      )}
      // Faded ends (touch only) while there is more to scroll that way.
      style={scrollFadeStyle(fadeMask)}
      role="toolbar"
      aria-label="Canvas tools"
      // PNG export filters out anything carrying this attribute so the
      // exported image shows the board, not the toolbar overlay.
      data-canvas-export-ignore="true"
    >
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} className="contents">
          {gi > 0 && <div aria-hidden="true" className="h-px bg-border/50 mx-1.5 my-1" />}
          {group.map((t) => {
            const Icon = t.icon;
            const active = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTool(t.id)}
                // Keep focus on the board so N / R / Delete keep working
                // after a mouse pick; Tab + Enter still reach the button.
                onMouseDown={keepBoardFocus}
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
                    : "text-sub hover:text-text hover:bg-surface-deep"
                )}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ))}
      {/* Diagram shape picker — separate from the regular tool grid
          because clicking it opens a popover rather than directly
          setting the tool. The popover then picks a shape kind and
          sets the tool to "diagramShape" with that kind primed in
          the store. */}
      <div aria-hidden="true" className="h-px bg-border/50 mx-1.5 my-1" />
      <button
        ref={diagramBtnRef}
        type="button"
        title="Diagram shapes"
        aria-label="Diagram shapes"
        aria-pressed={tool === "diagramShape"}
        onClick={() => {
          // Toggle: re-click closes the picker if it's already open.
          if (pickerAnchor) {
            setPickerAnchor(null);
            return;
          }
          const rect = diagramBtnRef.current?.getBoundingClientRect() ?? null;
          setPickerAnchor(rect);
        }}
        className={cn(
          "w-10 h-10 sm:w-9 sm:h-9 rounded-md flex items-center justify-center transition-colors shrink-0",
          tool === "diagramShape"
            ? "bg-accent/20 text-accent"
            : "text-sub hover:text-text hover:bg-surface-deep"
        )}
      >
        <Boxes className="w-4 h-4" aria-hidden="true" />
      </button>
      {/* Portalled to <body>: the picker is position:fixed beside the
          rail, and inside the rail it would be cut off by the rail's
          scroll box, its touch fade mask and its backdrop-filter (which
          makes the rail the containing block for fixed children). A
          sibling of the rail would not do either: the tool page's
          entrance animation leaves a transform on an ancestor, which
          would offset a fixed picker from the button's viewport rect. */}
      {pickerAnchor &&
        createPortal(
          <div ref={pickerHostRef} className="contents">
            <DiagramShapePicker anchorRect={pickerAnchor} onClose={closePicker} />
          </div>,
          document.body
        )}
    </div>
  );
}
