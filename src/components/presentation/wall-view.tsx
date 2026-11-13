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
 *  - holds nothing to press: nothing in the content takes a click, a tap,
 *    focus or a text selection, and only the shell's Exit button works. A
 *    screen reader still reads the content, and the page under the wall is
 *    inert (`usePresentingLayer`); focus goes back to the opener on close;
 *  - scrolls on a small screen when the content is taller than it (from
 *    `lg` up it fits the screen, as a wall does);
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

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  startPresenting,
  stopPresenting,
  usePresentation,
} from "@/components/presentation/presentation-mode";
import { usePresentingLayer } from "@/components/presentation/presenting-layer";
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

/** What could take focus inside the wall's content. */
const FOCUSABLE =
  "a[href],area[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable]";

/**
 * Keep everything inside `el` out of the Tab order (now, and whenever the
 * content re-renders) and swallow clicks, which a screen reader can still
 * send though nothing can be tapped. Unlike `inert`, the content stays
 * readable by a screen reader.
 */
function useNothingToPress(open: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const lock = () => {
      el.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((n) => {
        if (n.getAttribute("tabindex") !== "-1") n.setAttribute("tabindex", "-1");
      });
    };
    lock();
    const watch = new MutationObserver(lock);
    watch.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["tabindex", "href"],
    });
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("click", swallow, true);
    return () => {
      watch.disconnect();
      el.removeEventListener("click", swallow, true);
    };
  }, [open, ref]);
}

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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const close = useCallback(() => closeRef.current(), []);
  usePresentingLayer(open, headingRef, close);
  useNothingToPress(open, contentRef);

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
    <div
      data-wall-view
      role="dialog"
      aria-labelledby={headingId}
      className="fixed inset-0 z-[90] overflow-y-auto overflow-x-hidden bg-bg text-text lg:overflow-hidden"
    >
      <div className="mx-auto flex min-h-full max-w-[120rem] flex-col gap-6 px-4 py-6 sm:px-10 sm:py-8 lg:h-full">
        {/* Clear of the Exit presentation button, top right. */}
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pr-14 sm:pr-48">
          <h1
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="break-words text-3xl font-bold outline-none sm:text-5xl"
          >
            {title}
          </h1>
          <p className="font-data text-xl text-sub sm:text-2xl">
            <span className="sr-only">Updated at </span>
            {clock(tick.now)}
          </p>
        </header>
        {/* Nothing in here takes a click, a tap or focus (`useNothingToPress`),
            but a screen reader reads it. Below lg the layer scrolls. */}
        <div
          data-wall-content
          ref={contentRef}
          className="flex-1 select-none text-xl pointer-events-none sm:text-2xl lg:min-h-0 lg:overflow-hidden lg:[zoom:1.4]"
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
