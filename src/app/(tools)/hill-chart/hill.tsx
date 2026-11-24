"use client";

/**
 * The hill: one smooth bump in the comic ink look, the left half "Still
 * working it out", the right half "Getting it done", and a dot per scope
 * that drags along the curve (one linear axis from 0 to 100, the maths of
 * lib/utils/matrix). Each dot is a slider: arrow keys move it 5 (Shift 15),
 * Home and End go to the feet of the hill; each move is announced, and the
 * move is saved once, when it ends (the pointer lifts, Enter, the dot loses
 * focus, or the keys pause). Only the dots take `touch-none`, so a swipe
 * over the empty hill still scrolls the page on a phone. The scopes list
 * under it is the other keyboard and screen-reader path.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { cn } from "@/lib/utils";
import { nudge, valueAtFraction, type MatrixAxis } from "@/lib/utils/matrix";
import type { HillScope } from "@/lib/stores/workspace-types";
import { HILL_DONE, SIDE_LABEL, hillY, positionText, sideOf } from "@/lib/hill-chart/model";

/** The one axis: a whole number from 0 to 100. */
const AXIS: MatrixAxis = { kind: "linear", min: 0, max: HILL_DONE, step: 1 };
/** A keyboard move, and with Shift. */
const KEY_STEP = 5;
const SHIFT_STEP = 15;
/** Keys pausing this long save the move. */
const KEY_COMMIT_MS = 700;
/** A press that moves less than this is a tap, not a drag. */
const DRAG_PX = 4;

/** The drawing's box: 16 by 9, so the dots (laid over it in percentages) sit on the line. */
const W = 1000;
const H = 562;
/** The hill's feet sit this far in from each side, as a share of the width. */
const PAD = 0.05;
const BASE = 500;
const PEAK = 400;

/** Where position `p` sits across the box, 0 to 1. */
const across = (p: number) => PAD + (p / HILL_DONE) * (1 - 2 * PAD);
/** How far down the box the line is at position `p`, 0 to 1. */
const down = (p: number) => (BASE - hillY(p / HILL_DONE) * PEAK) / H;

/** The hill's line as an SVG path. */
const HILL_PATH = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 50; i++) {
    const p = (i / 50) * HILL_DONE;
    pts.push(`${(across(p) * W).toFixed(1)} ${(down(p) * H).toFixed(1)}`);
  }
  return `M ${pts.join(" L ")}`;
})();

export interface HillViewProps {
  scopes: readonly HillScope[];
  /** Ids of the stuck scopes: their dots get the warning ring. */
  stuckIds: ReadonlySet<string>;
  /** Save a move (once, when it ends). */
  onMove: (scopeId: string, position: number) => void;
  className?: string;
}

const DOT_TONE: Record<ReturnType<typeof sideOf>, string> = {
  uphill: "bg-accent text-bg",
  downhill: "bg-success text-bg",
  done: "bg-card text-success border-2 border-success",
};

export function HillView({ scopes, stuckIds, onMove, className }: HillViewProps) {
  const announce = useAnnounce();
  const boxRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ id: string; position: number } | null>(null);
  const pendingRef = useRef<{ id: string; position: number } | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; x: number; moved: boolean } | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (keyTimer.current) clearTimeout(keyTimer.current);
    },
    []
  );

  const byId = new Map(scopes.map((s) => [s.id, s]));

  const setMove = (next: { id: string; position: number } | null) => {
    pendingRef.current = next;
    setPending(next);
  };

  const commit = () => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = null;
    const p = pendingRef.current;
    if (!p) return;
    setMove(null);
    const s = byId.get(p.id);
    if (s && s.position !== p.position) onMove(p.id, p.position);
  };

  /** The position under a pointer, along the hill. */
  const positionAt = (clientX: number): number | null => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const f = (clientX - rect.left) / rect.width;
    return valueAtFraction(AXIS, (f - PAD) / (1 - 2 * PAD));
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best effort: the drag still works over the dot */
    }
    dragRef.current = { id, pointerId: e.pointerId, x: e.clientX, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < DRAG_PX) return;
    d.moved = true;
    const position = positionAt(e.clientX);
    if (position !== null) setMove({ id: d.id, position });
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    const s = byId.get(d.id);
    const p = pendingRef.current;
    if (s && p) announce(positionText(s.title, p.position));
    commit();
  };
  const onPointerCancel = () => {
    dragRef.current = null;
    setMove(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, s: HillScope) => {
    if (e.key === "Enter") {
      if (pendingRef.current?.id === s.id) {
        e.preventDefault();
        commit();
      }
      return;
    }
    const base = pendingRef.current?.id === s.id ? pendingRef.current.position : s.position;
    const step = e.shiftKey ? SHIFT_STEP : KEY_STEP;
    const to: Record<string, number> = {
      ArrowRight: nudge(AXIS, base, step),
      ArrowUp: nudge(AXIS, base, step),
      ArrowLeft: nudge(AXIS, base, -step),
      ArrowDown: nudge(AXIS, base, -step),
      Home: 0,
      End: HILL_DONE,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    const position = to[e.key];
    setMove({ id: s.id, position });
    announce(positionText(s.title, position));
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(commit, KEY_COMMIT_MS);
  };

  // Dots on the same spot stack a little upwards, in list order.
  const seen = new Map<number, number>();

  return (
    <div className={cn("space-y-2", className)}>
      <div ref={boxRef} className="relative aspect-video w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full text-text"
          aria-hidden="true"
        >
          <line
            x1={0}
            x2={W}
            y1={BASE}
            y2={BASE}
            className="stroke-border"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={W / 2}
            x2={W / 2}
            y1={BASE - PEAK - 30}
            y2={BASE}
            className="stroke-sub"
            strokeWidth={1.5}
            strokeDasharray="6 8"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={HILL_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {scopes.map((s, i) => {
          const moving = pending?.id === s.id;
          const position = moving ? (pending as { position: number }).position : s.position;
          const stack = seen.get(position) ?? 0;
          seen.set(position, stack + 1);
          const side = sideOf(position);
          return (
            <div
              key={s.id}
              role="slider"
              tabIndex={0}
              aria-label={s.title}
              aria-valuemin={0}
              aria-valuemax={HILL_DONE}
              aria-valuenow={position}
              aria-valuetext={positionText(s.title, position)}
              data-hill-dot={s.id}
              className={cn(
                "absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full text-xs font-semibold shadow-md transition-transform pointer-coarse:h-11 pointer-coarse:w-11",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                DOT_TONE[side],
                stuckIds.has(s.id) && "ring-2 ring-warning ring-offset-2 ring-offset-bg",
                moving && "scale-110 cursor-grabbing"
              )}
              style={{
                left: `${across(position) * 100}%`,
                top: `calc(${down(position) * 100}% - ${stack * 12}px)`,
              }}
              onKeyDown={(e) => onKeyDown(e, s)}
              onBlur={() => {
                if (pendingRef.current?.id === s.id) commit();
              }}
              onPointerDown={(e) => onPointerDown(e, s.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
            >
              <span aria-hidden="true">{i + 1}</span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-sub" aria-hidden="true">
        <span>← {SIDE_LABEL.uphill}</span>
        <span className="text-right">{SIDE_LABEL.downhill} →</span>
      </div>
    </div>
  );
}
