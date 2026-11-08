"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import { SonifiedDndContext } from "@/lib/sonification/sonified-dnd-context";
import { cn } from "@/lib/utils";

/**
 * Auto-scroll on touch screens. On a phone the lanes are a swipe row, each
 * 70–80 % of the screen wide, so the next lane shows only as a sliver at the
 * edge. dnd-kit's default edge zone (20 % of the row) covers that whole
 * sliver and scrolls at up to 2000 px/s, which carried a card past the lane
 * it was dropped on. A narrower side zone and half the speed leave the
 * sliver droppable. Mouse boards keep dnd-kit's defaults.
 */
const TOUCH_AUTO_SCROLL = { threshold: { x: 0.1, y: 0.2 }, acceleration: 5 };

/**
 * Turns off scroll snapping on the lanes' swipe row (and any other snapping
 * ancestor of the grip) for the length of a drag, and returns a function
 * that puts it back. dnd-kit auto-scrolls with many small `scrollBy` steps,
 * and under `scroll-snap-type: x mandatory` each step jumps a whole lane,
 * so a card raced to the last column. Putting the snap back re-snaps the
 * row to the lane nearest the drop.
 */
function suspendScrollSnap(from: EventTarget | null | undefined): () => void {
  const held: { el: HTMLElement; value: string; priority: string }[] = [];
  let el = from instanceof Element ? from.parentElement : null;
  while (el && el !== document.body) {
    const snap = getComputedStyle(el).getPropertyValue("scroll-snap-type").trim();
    if (snap && snap !== "none") {
      held.push({
        el,
        value: el.style.getPropertyValue("scroll-snap-type"),
        priority: el.style.getPropertyPriority("scroll-snap-type"),
      });
      el.style.setProperty("scroll-snap-type", "none");
    }
    el = el.parentElement;
  }
  return () => {
    for (const { el: node, value, priority } of held) {
      if (value) node.style.setProperty("scroll-snap-type", value, priority);
      else node.style.removeProperty("scroll-snap-type");
    }
  };
}

/**
 * Drag a card to another column with a mouse, pen or finger, on either
 * board. Keyboard and screen-reader users move cards with each card's Move
 * control instead, so the grip is a pointer-only affordance: out of the tab
 * order and hidden from assistive tech. The board announces where a card
 * went in its own words, so dnd-kit's announcements only cover picking up
 * and cancelling.
 *
 * The overlay that follows the pointer is portalled to `<body>`. It is
 * `position: fixed`, and any ancestor with a transform (a page entrance
 * animation, say) becomes its containing block: once the page was scrolled
 * the overlay drew a scroll's height off-screen, and dnd-kit, which finds the
 * column under the overlay's rect, never found one, so drops did nothing.
 */
export function BoardDnd({
  onMove,
  titleOf,
  renderOverlay,
  children,
}: {
  /** A card was dropped on a column (maybe its own: the board ignores that). */
  onMove: (itemId: string, columnId: string) => void;
  titleOf: (itemId: string) => string;
  /** What follows the pointer while dragging. */
  renderOverlay: (itemId: string) => ReactNode;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  // A few pixels of travel before a drag starts, so a tap on the grip
  // isn't a drop.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const mounted = useMounted();
  const coarse = useMediaQuery("(pointer: coarse)");

  const restoreSnap = useRef<(() => void) | null>(null);
  const endDrag = useCallback(() => {
    setActive(null);
    restoreSnap.current?.();
    restoreSnap.current = null;
  }, []);
  // A board that unmounts mid-drag (a tab switch) still gives the snap back.
  useEffect(() => () => restoreSnap.current?.(), []);

  const accessibility = useMemo(() => {
    const announcements: Announcements = {
      onDragStart: ({ active: a }) => `Picked up “${titleOf(String(a.id))}”.`,
      onDragOver: () => undefined,
      onDragEnd: () => undefined,
      onDragCancel: ({ active: a }) => `“${titleOf(String(a.id))}” was not moved.`,
    };
    return {
      announcements,
      screenReaderInstructions: {
        draggable: "To move a card with the keyboard, use its Move menu.",
      },
    };
  }, [titleOf]);

  return (
    <SonifiedDndContext
      sensors={sensors}
      accessibility={accessibility}
      autoScroll={coarse ? TOUCH_AUTO_SCROLL : true}
      onDragStart={({ active: a, activatorEvent }) => {
        setActive(String(a.id));
        restoreSnap.current?.();
        restoreSnap.current = suspendScrollSnap(activatorEvent?.target);
      }}
      onDragCancel={endDrag}
      onDragEnd={({ active: a, over }) => {
        endDrag();
        if (over) onMove(String(a.id), String(over.id));
      }}
    >
      {children}
      {/* Client-only: there is no <body> to portal into on the server, and
          nothing to show before the first drag anyway. */}
      {mounted &&
        createPortal(
          <DragOverlay dropAnimation={null}>{active ? renderOverlay(active) : null}</DragOverlay>,
          document.body
        )}
    </SonifiedDndContext>
  );
}

/** A column cards can be dropped on; tinted while a card is over it. */
export function DropColumn({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        "rounded-md transition-colors",
        isOver && "bg-accent/5 ring-1 ring-accent/40"
      )}
    >
      {children}
    </div>
  );
}

/**
 * A card that can be dragged by its grip. `children` gets the grip to place
 * (in the card's title row), so the rest of the card stays clickable. A
 * `disabled` card (on a read-only board) has no grip and can't be dragged.
 */
export function DraggableCard({
  id,
  disabled = false,
  className,
  children,
}: {
  id: string;
  disabled?: boolean;
  className?: string;
  children: (grip: ReactNode) => ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useDraggable({
    id,
    disabled,
  });
  const grip = disabled ? null : (
    <span
      ref={setActivatorNodeRef}
      {...listeners}
      aria-hidden="true"
      className="min-touch-coarse -ml-1 flex shrink-0 cursor-grab touch-none items-center justify-center rounded text-sub hover:text-text active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );
  return (
    <div ref={setNodeRef} className={cn(className, isDragging && "opacity-40")}>
      {children(grip)}
    </div>
  );
}

/** The card under the pointer while dragging: its title, on the card surface. */
export function DragPreview({ title }: { title: string }) {
  return (
    <div className="max-w-[16rem] cursor-grabbing rounded-md border border-accent/40 bg-card p-2 text-xs font-medium text-text shadow-lg">
      {title}
    </div>
  );
}
