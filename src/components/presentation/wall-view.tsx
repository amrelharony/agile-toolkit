"use client";

/**
 * Wall mode: a page's numbers on a screen nobody touches, such as a team
 * room's TV. It builds on Present mode (`presentation-mode.tsx`): the
 * shell's chrome goes, the browser goes fullscreen where it may, and Exit
 * presentation or Escape ends it. On top of that the view:
 *  - draws its content large, in a layer of its own over the page;
 *  - refreshes by itself (every 60 s unless told otherwise): its render
 *    prop gets the time, and `onRefresh` runs, so a dashboard re-reads its
 *    store;
 *  - holds nothing to press: the content is inert (no focus, no clicks, no
 *    text selection), and only the shell's Exit button works;
 *  - keeps the screen awake while it shows, where the browser allows.
 *
 * Example (the Sprint Cockpit wires its own in P1.12):
 *
 *   <WallViewButton title="Sprint 42">
 *     {({ now }) => <CockpitTiles sprint={sprint} now={now} />}
 *   </WallViewButton>
 *
 * or, controlled:
 *
 *   const [wall, setWall] = useState(false);
 *   <Button onClick={() => { startPresenting(); setWall(true); }}>Wall mode</Button>
 *   <WallView open={wall} onClose={() => setWall(false)} title="Sprint 42"
 *     refreshMs={30_000} onRefresh={reload}>
 *     <CockpitTiles … />
 *   </WallView>
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  startPresenting,
  stopPresenting,
  usePresentation,
} from "@/components/presentation/presentation-mode";
import { holdScreenAwake } from "@/lib/realtime/screen-wake-lock";

/** The default refresh: often enough for a sprint's numbers, rare enough to stay calm. */
export const WALL_VIEW_REFRESH_MS = 60_000;
/** Refreshing faster than this would be motion for its own sake. */
export const WALL_VIEW_MIN_REFRESH_MS = 5_000;

export interface WallTick {
  /** When this refresh ran (epoch ms). */
  now: number;
  /** How many refreshes have run since the view opened (0 at first). */
  n: number;
}

export interface WallViewProps {
  open: boolean;
  /** Present mode ended (Exit, Escape, leaving fullscreen). */
  onClose: () => void;
  /** The heading across the top, e.g. "Sprint 42". */
  title: string;
  /** How often it refreshes, in ms (at least 5 s). */
  refreshMs?: number;
  /** Runs on every refresh (not on opening): re-read a store, refetch. */
  onRefresh?: () => void;
  children: ReactNode | ((tick: WallTick) => ReactNode);
}

function clock(now: number): string {
  return new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const setInert = (el: HTMLDivElement | null) => el?.setAttribute("inert", "");

export function WallView({
  open,
  onClose,
  title,
  refreshMs = WALL_VIEW_REFRESH_MS,
  onRefresh,
  children,
}: WallViewProps) {
  const presenting = usePresentation((s) => s.presenting);
  const [tick, setTick] = useState<WallTick>(() => ({ now: Date.now(), n: 0 }));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const every = Math.max(WALL_VIEW_MIN_REFRESH_MS, refreshMs);

  useEffect(() => {
    if (!open) return;
    if (!usePresentation.getState().presenting) startPresenting();
    setTick({ now: Date.now(), n: 0 });
    const release = holdScreenAwake();
    return () => {
      release();
      stopPresenting();
    };
  }, [open]);

  // Present mode ended some other way: the wall closes with it.
  const sawRef = useRef(false);
  useEffect(() => {
    if (!open) {
      sawRef.current = false;
      return;
    }
    if (presenting) sawRef.current = true;
    else if (sawRef.current) closeRef.current();
  }, [open, presenting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      refreshRef.current?.();
      setTick((t) => ({ now: Date.now(), n: t.n + 1 }));
    }, every);
    return () => clearInterval(id);
  }, [open, every]);

  if (!open || typeof document === "undefined") return null;
  const content = typeof children === "function" ? children(tick) : children;

  return createPortal(
    <div data-wall-view className="fixed inset-0 z-[90] overflow-hidden bg-bg text-text">
      <div className="mx-auto flex h-full max-w-[120rem] flex-col gap-6 px-4 py-6 sm:px-10 sm:py-8">
        {/* Clear of the Exit presentation button, top right. */}
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pr-14 sm:pr-48">
          <h1 className="break-words text-3xl font-bold sm:text-5xl">{title}</h1>
          <p className="font-data text-xl text-sub sm:text-2xl">
            <span className="sr-only">Updated at </span>
            {clock(tick.now)}
          </p>
        </header>
        {/* Nothing in here takes a click, a tap or focus. React 18 has no
            boolean `inert` prop, so the attribute is set on the element. */}
        <div
          data-wall-content
          ref={setInert}
          className="min-h-0 flex-1 select-none overflow-hidden text-xl pointer-events-none sm:text-2xl lg:[zoom:1.4]"
        >
          {content}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * "Wall mode": a button that opens `WallView` over the page, in the same
 * tick as the click so the browser lets it go fullscreen.
 */
export function WallViewButton({
  title,
  refreshMs,
  onRefresh,
  label = "Wall mode",
  children,
}: Omit<WallViewProps, "open" | "onClose"> & { label?: string }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => {
    startPresenting();
    setOpen(true);
  }, []);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        title="Show this on a screen nobody touches, refreshing by itself"
        onClick={show}
      >
        <Tv aria-hidden="true" />
        {label}
      </Button>
      <WallView
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        refreshMs={refreshMs}
        onRefresh={onRefresh}
      >
        {children}
      </WallView>
    </>
  );
}
