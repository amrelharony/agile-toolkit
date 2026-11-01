"use client";

/**
 * A draggable 2×2, shared by the Stakeholder Map (interest × authority) and
 * the Value vs Effort matrix (effort × value).
 *
 * Drag a dot (or a chip from "Not placed yet") with the pointer, or focus a
 * dot and use the arrow keys (Left/Right the x axis, Up/Down the y axis,
 * Shift for 3 steps); each chip also has a "Place in…" picker. Every move
 * is announced, and saved once when it ends (pointer up, Enter, blur, or a
 * moment after the last key). Tapping a dot selects it.
 *
 * Only the dots and chips take `touch-none`: a swipe over the empty map
 * still scrolls the page on a phone. The axes' maths is lib/utils/matrix.
 *
 * The panes divide where each axis turns high (an axis's `highFrom`, see
 * axisSplit): the middle by default, as on the Stakeholder Map; about 58%
 * up on Value/Effort's Fibonacci value axis, so a drop lands in the pane
 * whose quadrant the value derives.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { cn } from "@/lib/utils";
import {
  atFromPointer,
  axisMin,
  axisSplit,
  fanOut,
  nudge,
  percentAlong,
  type MatrixAt,
  type MatrixAxis,
} from "@/lib/utils/matrix";

/** A pointer that moves less than this is a tap (select), not a drag. */
export const DRAG_PX = 4;
/** Keyboard moves are saved this long after the last key (or on blur / Enter). */
export const KEY_COMMIT_MS = 800;

export type PlaceHow = "drag" | "keys" | "pick";

/** What the matrix needs of an item: its id and where it is (null: not placed). */
export interface DragMatrixItem {
  id: string;
  x: number | null;
  y: number | null;
}

/** One quadrant pane, in drawing order: top-left, top-right, bottom-left, bottom-right. */
export interface DragMatrixPane {
  id: string;
  label: string;
  /** Its tint and text colour, as theme tokens. */
  className: string;
  align?: "left" | "right";
}

/** One "Place in…" option: an explicit spot, never a default. */
export interface DragMatrixPlace {
  id: string;
  label: string;
  at: MatrixAt;
}

export interface DragMatrixProps<T extends DragMatrixItem> {
  items: readonly T[];
  xAxis: MatrixAxis;
  yAxis: MatrixAxis;
  /** Shown over the map's top-left ("↑ Authority"). */
  yLabel: string;
  /** Shown under the map's bottom-right ("Interest →"). */
  xLabel: string;
  /** The map's accessible name ("Interest × Authority map"). */
  label: string;
  /** How to move a dot, under the tray. */
  help: ReactNode;
  panes: readonly [DragMatrixPane, DragMatrixPane, DragMatrixPane, DragMatrixPane];
  places: readonly DragMatrixPlace[];
  /** The tray's heading. Default "Not placed yet". */
  trayTitle?: string;
  /** "interest 7, authority 8, Manage Closely" (announced after each move). */
  positionText: (at: { x: number | null; y: number | null }) => string;
  /** The name an announcement starts with. */
  itemName: (item: T) => string;
  /** A dot's accessible name, given its position text. */
  dotLabel?: (item: T, position: string) => string;
  /** A tray chip's accessible name. */
  chipLabel?: (item: T) => string;
  /** The "Place in…" picker's accessible name. */
  placeLabel?: (item: T) => string;
  /** A dot's fill (theme tokens). */
  dotClass: (item: T) => string;
  /** Under the map: what the dot colours mean. */
  legend?: ReactNode;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onPlace: (id: string, at: MatrixAt, how: PlaceHow) => void;
}

interface Pending {
  id: string;
  x: number;
  y: number;
}

interface DragState {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

const isPlaced = (i: DragMatrixItem) => i.x !== null && i.y !== null;

export function DragMatrix<T extends DragMatrixItem>({
  items,
  xAxis,
  yAxis,
  yLabel,
  xLabel,
  label,
  help,
  panes,
  places,
  trayTitle = "Not placed yet",
  positionText,
  itemName,
  dotLabel = (item, position) => `${itemName(item)}: ${position}`,
  chipLabel = (item) => `${itemName(item)}: not placed yet. Drag onto the map, or pick a spot.`,
  placeLabel = (item) => `Place ${itemName(item)} in`,
  dotClass,
  legend,
  selectedId = null,
  onSelect,
  onPlace,
}: DragMatrixProps<T>) {
  const announce = useAnnounce();
  // A pick from "Place in…" removes its chip (and the focused select with
  // it): focus moves to the item's new dot on the map.
  const { refFor, returnTo } = useReturnFocus();
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;
  const helpId = useId();

  useEffect(
    () => () => {
      if (keyTimer.current) clearTimeout(keyTimer.current);
    },
    []
  );

  const byId = new Map(items.map((s) => [s.id, s]));
  const placed = items.filter(isPlaced);
  const unplaced = items.filter((s) => !isPlaced(s));

  /** Where a pointer is on the map, snapped to the axes; null outside it. */
  const pointAt = (clientX: number, clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return atFromPointer(rect, clientX, clientY, xAxis, yAxis);
  };

  const commit = (how: PlaceHow) => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = null;
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setPending(null);
    const s = byId.get(p.id);
    if (!s || (s.x === p.x && s.y === p.y)) return;
    onPlace(p.id, { x: p.x, y: p.y }, how);
  };

  /* ── Pointer: dots and tray chips ─────────────────────────────────── */

  const onPointerDown = (e: PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return;
    try {
      // Keeps the moves coming when the pointer outruns the dot.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best effort: the drag still works over the dot */
    }
    dragRef.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
    d.moved = true;
    const at = pointAt(e.clientX, e.clientY);
    const next = at ? { id: d.id, ...at } : null;
    pendingRef.current = next;
    setPending(next);
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    const s = byId.get(d.id);
    const p = pendingRef.current;
    if (s && p) announce(`${itemName(s)}: ${positionText(p)}`);
    // A chip dragged from the tray goes with its focus: on to its new dot.
    if (s && p && !isPlaced(s)) returnTo(`dot:${s.id}`);
    commit("drag");
  };
  const pointer = (id: string) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => onPointerDown(e, id),
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => {
      dragRef.current = null;
      pendingRef.current = null;
      setPending(null);
    },
  });

  /* ── Keyboard: a focused dot ──────────────────────────────────────── */

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, s: T) => {
    if (e.key === "Enter" && pendingRef.current?.id === s.id) {
      e.preventDefault();
      commit("keys");
      return;
    }
    const step = e.shiftKey ? 3 : 1;
    const move: Record<string, ["x" | "y", number]> = {
      ArrowRight: ["x", step],
      ArrowLeft: ["x", -step],
      ArrowUp: ["y", step],
      ArrowDown: ["y", -step],
    };
    const m = move[e.key];
    if (!m) return;
    e.preventDefault();
    const base = pendingRef.current?.id === s.id ? pendingRef.current : s;
    const [axis, delta] = m;
    const p = {
      id: s.id,
      x: axis === "x" ? nudge(xAxis, base.x, delta) : (base.x ?? axisMin(xAxis)),
      y: axis === "y" ? nudge(yAxis, base.y, delta) : (base.y ?? axisMin(yAxis)),
    };
    pendingRef.current = p;
    setPending(p);
    announce(`${itemName(s)}: ${positionText(p)}`);
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => commit("keys"), KEY_COMMIT_MS);
  };

  /* ── Drawing ──────────────────────────────────────────────────────── */

  // Where each dot is drawn: its saved place, or where it's being moved to.
  const shown: (T & { x: number; y: number })[] = [
    ...placed.map((s) => (pending?.id === s.id ? { ...s, ...pending } : s)),
    ...(pending && unplaced.some((s) => s.id === pending.id)
      ? [{ ...(byId.get(pending.id) as T), ...pending }]
      : []),
  ] as (T & { x: number; y: number })[];
  // Items on the same spot fan out a little, with a count on the first.
  const fan = fanOut(shown);
  // Pane sizes as grid fractions, to 4 places (sub-pixel on any screen).
  const fr = (n: number) => `minmax(0, ${Math.round(n * 1e4) / 1e4}fr)`;
  const xSplit = axisSplit(xAxis);
  const ySplit = axisSplit(yAxis);

  return (
    <div className="space-y-3">
      {unplaced.length > 0 && (
        <section aria-label={trayTitle} className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-sub">
            {trayTitle} ({unplaced.length})
          </h3>
          <ul className="flex flex-wrap gap-2">
            {unplaced.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-1 pr-2"
              >
                <button
                  type="button"
                  className={cn(
                    "min-touch-coarse inline-flex min-h-8 touch-none items-center gap-1.5 rounded-full px-2 text-xs text-text",
                    "cursor-grab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    selectedId === s.id && "ring-2 ring-accent"
                  )}
                  onClick={() => onSelect?.(s.id)}
                  aria-label={chipLabel(s)}
                  {...pointer(s.id)}
                >
                  <span className={cn("h-3 w-3 rounded-full", dotClass(s))} aria-hidden="true" />
                  {itemName(s)}
                </button>
                <select
                  aria-label={placeLabel(s)}
                  value=""
                  onChange={(e) => {
                    const place = places.find((p) => p.id === e.target.value);
                    if (!place) return;
                    // An explicit choice, never a default.
                    returnTo(`dot:${s.id}`);
                    onPlace(s.id, place.at, "pick");
                  }}
                  className="h-8 rounded-md border border-input bg-background px-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Place in…</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p id={helpId} className="text-xs text-sub">
        {help}
      </p>
      <div className="text-xs uppercase tracking-wider text-sub" aria-hidden="true">
        {yLabel}
      </div>
      <div
        ref={gridRef}
        role="group"
        aria-label={label}
        aria-describedby={helpId}
        // Only the dots and chips take touch-none: a swipe over the empty
        // map still scrolls the page on a phone.
        className="relative mx-auto aspect-square w-full max-w-xl"
      >
        <div
          className="absolute inset-0 grid gap-px overflow-hidden rounded-lg bg-border"
          // The panes divide where each axis turns high (axisSplit): 50/50
          // unless the axis says otherwise, ~58% up on a Fibonacci value axis.
          style={{
            gridTemplateColumns: `${fr(xSplit)} ${fr(1 - xSplit)}`,
            gridTemplateRows: `${fr(1 - ySplit)} ${fr(ySplit)}`,
          }}
        >
          {/* Each pane's tint sits on an opaque bg-bg: the grid behind is
              bg-border (its 1 px gaps are the lines), and a bare 5% tint let
              it through, white in high contrast, under yellow and green labels. */}
          {panes.map((pane) => (
            <div key={pane.id} className="bg-bg">
              <div
                className={cn("h-full p-2", pane.className, pane.align === "right" && "text-right")}
              >
                <div className="text-xs uppercase tracking-wider opacity-80">{pane.label}</div>
              </div>
            </div>
          ))}
        </div>
        {shown.map((s) => {
          const f = fan.get(s.id) ?? { dx: 0, dy: 0, count: 1, first: true };
          const left = percentAlong(xAxis, s.x);
          const top = 100 - percentAlong(yAxis, s.y);
          const moving = pending?.id === s.id;
          return (
            <button
              key={s.id}
              ref={refFor(`dot:${s.id}`)}
              type="button"
              className={cn(
                "absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full shadow-md transition-transform",
                "cursor-grab focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                dotClass(s),
                selectedId === s.id && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
                moving && "scale-110 cursor-grabbing"
              )}
              style={{
                left: `calc(${left}% + ${f.dx}px)`,
                top: `calc(${top}% + ${f.dy}px)`,
              }}
              aria-label={dotLabel(s, positionText(s))}
              onClick={() => onSelect?.(s.id)}
              onKeyDown={(e) => onKeyDown(e, byId.get(s.id) as T)}
              onBlur={() => {
                if (pendingRef.current?.id === s.id) commit("keys");
              }}
              {...pointer(s.id)}
            >
              {f.first && f.count > 1 && (
                <span
                  className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-text px-1 text-xs font-medium leading-none text-bg"
                  aria-hidden="true"
                >
                  {f.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="text-right text-xs uppercase tracking-wider text-sub" aria-hidden="true">
        {xLabel}
      </div>
      {legend}
    </div>
  );
}
