"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { cn } from "@/lib/utils";
import {
  QUADRANTS,
  QUADRANT_CENTRE,
  QUADRANT_LABEL,
  SENTIMENTS,
  SENTIMENT_LABEL,
  clampScore,
  gapText,
  isPlaced,
  moveBy,
  positionText,
  sentimentGap,
  type Quadrant,
  type Sentiment,
  type Stakeholder,
} from "./model";

/** A dot's fill: the current sentiment, as theme tokens (never a hex). */
export const SENTIMENT_DOT: Record<Sentiment, string> = {
  champion: "bg-success",
  supporter: "bg-success/60",
  neutral: "bg-sub",
  skeptic: "bg-warning",
  blocker: "bg-danger",
};
const UNRATED_DOT = "bg-card border-2 border-sub";

/** A pointer that moves less than this is a tap (select), not a drag. */
const DRAG_PX = 4;
/** Keyboard moves are saved this long after the last key (or on blur / Enter). */
const KEY_COMMIT_MS = 800;

export type PlaceHow = "drag" | "keys" | "pick";

interface Pending {
  id: string;
  interest: number;
  authority: number;
}

interface DragState {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

const dotClass = (s: Pick<Stakeholder, "currentSentiment">) =>
  s.currentSentiment ? SENTIMENT_DOT[s.currentSentiment] : UNRATED_DOT;

/** Quadrant panes, top row high authority: Keep Satisfied, Manage Closely. */
const PANES: { q: Quadrant; className: string; align: string }[] = [
  { q: "keepSatisfied", className: "bg-warning/5 text-warning", align: "" },
  { q: "manageClosely", className: "bg-accent/10 text-accent", align: "text-right" },
  { q: "monitor", className: "bg-bg text-sub", align: "" },
  { q: "keepInformed", className: "bg-success/5 text-success", align: "text-right" },
];

/**
 * The Interest × Authority 2×2, interactive: drag a dot (or a chip from
 * "Not placed yet") with the pointer, or focus a dot and use the arrow keys
 * (Left/Right interest, Up/Down authority, Shift for 3 steps); each chip
 * also has a "Place in…" picker. Every move is announced, and saved once
 * when it ends (pointer up, Enter, blur, or a moment after the last key).
 * Tapping a dot selects it for the detail panel.
 */
export function StakeholderMap({
  stakeholders,
  selectedId,
  onSelect,
  onPlace,
}: {
  stakeholders: readonly Stakeholder[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlace: (id: string, at: { interest: number; authority: number }, how: PlaceHow) => void;
}) {
  const announce = useAnnounce();
  // A pick from "Place in…" removes its chip (and the focused select with
  // it): focus moves to the stakeholder's new dot on the map.
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

  const byId = new Map(stakeholders.map((s) => [s.id, s]));
  const placed = stakeholders.filter(isPlaced);
  const unplaced = stakeholders.filter((s) => !isPlaced(s));

  /** Where a pointer is on the map, on the 0–10 scale; null outside it. */
  const pointAt = (clientX: number, clientY: number) => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { interest: clampScore(x * 10), authority: clampScore((1 - y) * 10) };
  };

  const commit = (how: PlaceHow) => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = null;
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setPending(null);
    const s = byId.get(p.id);
    if (!s || (s.interest === p.interest && s.authority === p.authority)) return;
    onPlace(p.id, { interest: p.interest, authority: p.authority }, how);
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
    if (s && p) announce(`${s.name}: ${positionText(p)}`);
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

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, s: Stakeholder) => {
    if (e.key === "Enter" && pendingRef.current?.id === s.id) {
      e.preventDefault();
      commit("keys");
      return;
    }
    const step = e.shiftKey ? 3 : 1;
    const move: Record<string, ["interest" | "authority", number]> = {
      ArrowRight: ["interest", step],
      ArrowLeft: ["interest", -step],
      ArrowUp: ["authority", step],
      ArrowDown: ["authority", -step],
    };
    const m = move[e.key];
    if (!m) return;
    e.preventDefault();
    const base = pendingRef.current?.id === s.id ? { ...s, ...pendingRef.current } : s;
    const next = moveBy(base, m[0], m[1]);
    const p = { id: s.id, interest: next.interest ?? 0, authority: next.authority ?? 0 };
    pendingRef.current = p;
    setPending(p);
    announce(`${s.name}: ${positionText(p)}`);
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => commit("keys"), KEY_COMMIT_MS);
  };

  /* ── Drawing ──────────────────────────────────────────────────────── */

  // Where each dot is drawn: its saved place, or where it's being moved to.
  const shown = [
    ...placed.map((s) => (pending?.id === s.id ? { ...s, ...pending } : s)),
    ...(pending && unplaced.some((s) => s.id === pending.id)
      ? [{ ...(byId.get(pending.id) as Stakeholder), ...pending }]
      : []),
  ];
  // Stakeholders on the same spot fan out a little, with a count on the first.
  const atSpot = new Map<string, number>();
  const spotIndex = shown.map((s) => {
    const key = `${s.interest}:${s.authority}`;
    const i = atSpot.get(key) ?? 0;
    atSpot.set(key, i + 1);
    return { key, i };
  });

  return (
    <div className="space-y-3">
      {unplaced.length > 0 && (
        <section aria-label="Not placed yet" className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wider text-sub">
            Not placed yet ({unplaced.length})
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
                  onClick={() => onSelect(s.id)}
                  aria-label={`${s.name}: not placed yet. Drag onto the map, or pick a quadrant.`}
                  {...pointer(s.id)}
                >
                  <span className={cn("h-3 w-3 rounded-full", dotClass(s))} aria-hidden="true" />
                  {s.name}
                </button>
                <select
                  aria-label={`Place ${s.name} in`}
                  value=""
                  onChange={(e) => {
                    const q = e.target.value as Quadrant;
                    if (!q) return;
                    // The quadrant's middle: an explicit choice, never a default.
                    returnTo(`dot:${s.id}`);
                    onPlace(s.id, QUADRANT_CENTRE[q], "pick");
                  }}
                  className="h-8 rounded-md border border-input bg-background px-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Place in…</option>
                  {QUADRANTS.map((q) => (
                    <option key={q} value={q}>
                      {QUADRANT_LABEL[q]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p id={helpId} className="text-xs text-sub">
        Drag a dot, or focus it and use the arrow keys (Shift moves 3). Tap one to see their
        details.
      </p>
      <div className="text-xs uppercase tracking-wider text-sub" aria-hidden="true">
        ↑ Authority
      </div>
      <div
        ref={gridRef}
        role="group"
        aria-label="Interest × Authority map"
        aria-describedby={helpId}
        // Only the dots and chips take touch-none: a swipe over the empty
        // map still scrolls the page on a phone.
        className="relative mx-auto aspect-square w-full max-w-xl"
      >
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-lg bg-border">
          {/* Each pane's tint sits on an opaque bg-bg: the grid behind is
              bg-border (its 1 px gaps are the lines), and a bare 5% tint let
              it through, white in high contrast, under yellow and green labels. */}
          {PANES.map(({ q, className, align }) => (
            <div key={q} className="bg-bg">
              <div className={cn("h-full p-2", className, align)}>
                <div className="text-xs uppercase tracking-wider opacity-80">
                  {QUADRANT_LABEL[q]}
                </div>
              </div>
            </div>
          ))}
        </div>
        {shown.map((s, idx) => {
          const { key, i } = spotIndex[idx];
          const count = atSpot.get(key) ?? 1;
          const left = Math.min(96, Math.max(4, ((s.interest ?? 0) / 10) * 100));
          const top = Math.min(96, Math.max(4, 100 - ((s.authority ?? 0) / 10) * 100));
          const dx = i === 0 ? 0 : ((i % 3) - 1) * 10;
          const dy = i === 0 ? 0 : (Math.floor(i / 3) + 1) * 8;
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
                left: `calc(${left}% + ${dx}px)`,
                top: `calc(${top}% + ${dy}px)`,
              }}
              aria-label={`${s.name}${s.role ? `, ${s.role}` : ""}: ${positionText(s)}`}
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => onKeyDown(e, byId.get(s.id) as Stakeholder)}
              onBlur={() => {
                if (pendingRef.current?.id === s.id) commit("keys");
              }}
              {...pointer(s.id)}
            >
              {i === 0 && count > 1 && (
                <span
                  className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-text px-1 text-xs font-medium leading-none text-bg"
                  aria-hidden="true"
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="text-right text-xs uppercase tracking-wider text-sub" aria-hidden="true">
        Interest →
      </div>

      <ul className="flex flex-wrap justify-center gap-3 text-xs" aria-label="Sentiment legend">
        {SENTIMENTS.map((s) => (
          <li key={s} className="flex items-center gap-1.5 text-sub">
            <span className={cn("h-3 w-3 rounded-full", SENTIMENT_DOT[s])} aria-hidden="true" />
            {SENTIMENT_LABEL[s]}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-sub">
          <span className={cn("h-3 w-3 rounded-full", UNRATED_DOT)} aria-hidden="true" />
          Not set
        </li>
      </ul>
    </div>
  );
}

/**
 * The selected stakeholder's details beside (or under) the map. Not a live
 * region: every move would re-read the whole card over the announcer's
 * "<name>: interest …", which says what changed.
 */
export function StakeholderDetail({
  stakeholder: s,
  lastContactText,
  nextTouchText,
}: {
  stakeholder: Stakeholder | null;
  lastContactText: string;
  nextTouchText: string;
}) {
  if (!s) {
    return (
      <section
        aria-label="Selected stakeholder"
        className="rounded-lg border border-dashed border-border p-3 text-xs text-sub"
      >
        Tap a dot (or press Enter on it) to see who it is.
      </section>
    );
  }
  const gap = gapText(sentimentGap(s));
  return (
    <section
      aria-label="Selected stakeholder"
      className="rounded-lg border border-border bg-card p-3 text-xs"
    >
      <div className="text-sm font-semibold text-text">{s.name}</div>
      {s.role && <div className="text-sub">{s.role}</div>}
      <div className="mt-1 text-sub">{positionText(s)}</div>
      <div className="mt-1 text-sub">
        {s.currentSentiment ? SENTIMENT_LABEL[s.currentSentiment] : "Sentiment not set"}
        {s.desiredSentiment && ` → ${SENTIMENT_LABEL[s.desiredSentiment]}`}
        {gap && ` (${gap})`}
      </div>
      <div className="mt-1 text-sub">
        {lastContactText} · {nextTouchText}
      </div>
    </section>
  );
}
