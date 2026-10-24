"use client";

import { useMemo, useState, type ReactNode } from "react";
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
import { SonifiedDndContext } from "@/lib/sonification/sonified-dnd-context";
import { cn } from "@/lib/utils";

/**
 * Drag a card to another column with a mouse, pen or finger, on either
 * board. Keyboard and screen-reader users move cards with each card's Move
 * control instead, so the grip is a pointer-only affordance: out of the tab
 * order and hidden from assistive tech. The board announces where a card
 * went in its own words, so dnd-kit's announcements only cover picking up
 * and cancelling.
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
      onDragStart={({ active: a }) => setActive(String(a.id))}
      onDragCancel={() => setActive(null)}
      onDragEnd={({ active: a, over }) => {
        setActive(null);
        if (over) onMove(String(a.id), String(over.id));
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{active ? renderOverlay(active) : null}</DragOverlay>
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
