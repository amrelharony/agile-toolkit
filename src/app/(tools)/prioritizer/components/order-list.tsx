"use client";

/**
 * A list the team puts in order (the Decide order step, a MoSCoW bucket).
 *
 * - Pointer: drag a row by its grip (mouse, pen or finger; a few pixels of
 *   travel first, so a tap isn't a drop).
 * - Keyboard: focus the grip and press the up or down arrow (Home and End
 *   for the top and the bottom), or use the row's Move up / Move down
 *   buttons and its position menu, which also suit touch.
 * - Every move is said in words on the list's status line ("Moved “X” to
 *   3 of 12."), a polite live region, and focus stays on the control that
 *   moved the row, now in its new place.
 *
 * The list only reports moves (`onMove`); the parent decides whether a move
 * edits a draft (Decide order) or saves at once (the MoSCoW tab).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PointerSensor, useSensor, useSensors, type Announcements } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { SonifiedDndContext } from "@/lib/sonification/sonified-dnd-context";
import { cn } from "@/lib/utils";
import { movedText } from "../order";

type Control = "grip" | "up" | "down" | "position";

export interface OrderListProps {
  ids: readonly string[];
  /** The list's accessible name ("Your order", "Must have, in order"). */
  label: string;
  nameOf: (id: string) => string;
  /** Move `id` to index `to` (0-based, already within the list). */
  onMove: (id: string, to: number) => void;
  /** Where the list is, for the status line: " in Must have". */
  where?: string;
  /** Extra content under a row's name (its consensus place, a score). */
  meta?: (id: string) => ReactNode;
  /** Take a row out of the list (back to "Not ordered yet"). */
  onRemove?: (id: string) => void;
  /**
   * Focus this row's grip once it is on screen (a row just added, or the
   * one that took a removed row's place); `onFocused` then clears it.
   */
  focusId?: string | null;
  onFocused?: () => void;
  className?: string;
}

export function OrderList({
  ids,
  label,
  nameOf,
  onMove,
  where = "",
  meta,
  onRemove,
  focusId,
  onFocused,
  className,
}: OrderListProps) {
  const [status, setStatus] = useState("");
  const controls = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);

  // After the move renders, focus the control that made it, in its new place.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    controls.current.get(key)?.focus();
  });

  useEffect(() => {
    if (!focusId) return;
    const grip = controls.current.get(`grip:${focusId}`);
    if (!grip) return;
    grip.focus();
    onFocused?.();
  }, [focusId, ids, onFocused]);

  const register = (control: Control, id: string) => (el: HTMLElement | null) => {
    const key = `${control}:${id}`;
    if (el) controls.current.set(key, el);
    else controls.current.delete(key);
  };

  const move = (id: string, to: number, control: Control) => {
    const from = ids.indexOf(id);
    if (from < 0) return;
    const at = Math.max(0, Math.min(ids.length - 1, to));
    const name = nameOf(id);
    if (at === from) {
      setStatus(
        from === 0 && to < 0
          ? `“${name}” is already first.`
          : from === ids.length - 1 && to > from
            ? `“${name}” is already last.`
            : `“${name}” stays at ${from + 1} of ${ids.length}.`
      );
      return;
    }
    onMove(id, at);
    pendingFocus.current = `${control}:${id}`;
    setStatus(movedText(name, at + 1, ids.length, where));
  };

  // A few pixels of travel before a drag starts, so a tap on the grip isn't a drop.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const accessibility = useMemo(() => {
    const announcements: Announcements = {
      onDragStart: ({ active }) => `Picked up “${nameOf(String(active.id))}”.`,
      // The status line says where it went.
      onDragOver: () => undefined,
      onDragEnd: () => undefined,
      onDragCancel: ({ active }) => `“${nameOf(String(active.id))}” was not moved.`,
    };
    return {
      announcements,
      screenReaderInstructions: {
        draggable:
          "Press the up or down arrow to move it, Home or End to move it to the top or the bottom. With a mouse or a finger, drag it.",
      },
    };
  }, [nameOf]);

  return (
    <div className={className}>
      <SonifiedDndContext
        sensors={sensors}
        accessibility={accessibility}
        onDragEnd={({ active, over }) => {
          if (!over || over.id === active.id) return;
          move(String(active.id), ids.indexOf(String(over.id)), "grip");
        }}
      >
        <SortableContext items={ids as string[]} strategy={verticalListSortingStrategy}>
          <ol aria-label={label} className="divide-y divide-border">
            {ids.map((id, index) => (
              <OrderRow
                key={id}
                id={id}
                index={index}
                count={ids.length}
                name={nameOf(id)}
                meta={meta?.(id)}
                register={register}
                onMove={(to, control) => move(id, to, control)}
                onRemove={onRemove ? () => onRemove(id) : undefined}
              />
            ))}
          </ol>
        </SortableContext>
      </SonifiedDndContext>
      <p role="status" className="mt-2 min-h-5 text-xs text-sub">
        {status}
      </p>
    </div>
  );
}

function OrderRow({
  id,
  index,
  count,
  name,
  meta,
  register,
  onMove,
  onRemove,
}: {
  id: string;
  index: number;
  count: number;
  name: string;
  meta?: ReactNode;
  register: (control: Control, id: string) => (el: HTMLElement | null) => void;
  onMove: (to: number, control: Control) => void;
  onRemove?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const gripRef = register("grip", id);
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 bg-card py-2",
        isDragging && "relative z-10 opacity-60"
      )}
    >
      <button
        type="button"
        ref={(el) => {
          setActivatorNodeRef(el);
          gripRef(el);
        }}
        {...attributes}
        {...listeners}
        aria-label={`Reorder “${name}”, ${index + 1} of ${count}`}
        onKeyDown={(e) => {
          const to =
            e.key === "ArrowUp"
              ? index - 1
              : e.key === "ArrowDown"
                ? index + 1
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? count - 1
                    : null;
          if (to === null) return;
          e.preventDefault();
          onMove(to, "grip");
        }}
        className="min-touch-coarse flex h-8 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded text-sub hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="w-6 shrink-0 font-mono text-sm text-sub" aria-hidden="true">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 basis-40 text-sm text-text">
        <span className="break-words">{name}</span>
        {meta && <span className="block text-xs text-sub">{meta}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <label className="sr-only" htmlFor={`position-${id}`}>
          Position of “{name}”
        </label>
        <select
          id={`position-${id}`}
          ref={register("position", id)}
          value={index}
          onChange={(e) => onMove(Number(e.target.value), "position")}
          className="h-8 rounded border border-border bg-surface-deep px-1 text-sm text-text focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {Array.from({ length: count }, (_, i) => (
            <option key={i} value={i}>
              {i + 1}
            </option>
          ))}
        </select>
        <IconButton
          ref={register("up", id)}
          label={`Move “${name}” up`}
          icon={<ArrowUp className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={() => onMove(index - 1, "up")}
        />
        <IconButton
          ref={register("down", id)}
          label={`Move “${name}” down`}
          icon={<ArrowDown className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={() => onMove(index + 1, "down")}
        />
        {onRemove && (
          <IconButton
            label={`Take “${name}” out of the order`}
            icon={<X className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={onRemove}
          />
        )}
      </span>
    </li>
  );
}
