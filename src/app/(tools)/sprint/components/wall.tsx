"use client";

/**
 * Wall mode for the Sprint Cockpit: the sprint on a screen nobody touches,
 * such as a team room's TV, in large type and refreshing by itself.
 *
 * `CockpitWallView` is a small local stand-in with the props of the shared
 * `WallView` (components/presentation/wall-view, from the room-extras work)
 * so the cockpit can switch to it by changing one import: open / onClose /
 * title / refreshMs / onRefresh / children as content or a render prop
 * that gets the refresh tick. Like it, it builds on Present mode: opening
 * starts presenting (the shell's chrome goes, the browser goes fullscreen
 * where it may), and leaving Present mode (Exit presentation, Escape,
 * leaving fullscreen) closes it. Nothing in the content takes a click or
 * focus; a screen reader still reads it.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  startPresenting,
  stopPresenting,
  usePresentation,
} from "@/components/presentation/presentation-mode";
import { StatCard } from "@/components/shared/stat-card";
import { CEREMONY_LABEL, whenLabel, type CeremonyOccurrence } from "@/lib/sprints/cadence";
import type { Tile } from "@/lib/sprints/hub-view";
import { RISK_LEVEL_LABEL, type SprintRisk } from "@/lib/sprints/risk";
import { cn } from "@/lib/utils";

/** How often the wall refreshes: often enough for a sprint, rare enough to stay calm. */
export const WALL_REFRESH_MS = 60_000;

export interface WallTick {
  /** When this refresh ran (epoch ms). */
  now: number;
  /** Refreshes since the view opened (0 at first). */
  n: number;
}

export interface CockpitWallViewProps {
  open: boolean;
  /** Present mode ended, or the view was closed. */
  onClose: () => void;
  /** The heading across the top. */
  title: string;
  refreshMs?: number;
  onRefresh?: () => void;
  children: ReactNode | ((tick: WallTick) => ReactNode);
}

function clock(now: number): string {
  return new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The local wall view (see the module comment): a layer over the page, in large type. */
export function CockpitWallView({
  open,
  onClose,
  title,
  refreshMs = WALL_REFRESH_MS,
  onRefresh,
  children,
}: CockpitWallViewProps) {
  const presenting = usePresentation((s) => s.presenting);
  const [tick, setTick] = useState<WallTick>(() => ({ now: Date.now(), n: 0 }));
  const closeRef = useRef(onClose);
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    closeRef.current = onClose;
    refreshRef.current = onRefresh;
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!usePresentation.getState().presenting) startPresenting();
    setTick({ now: Date.now(), n: 0 });
    headingRef.current?.focus();
    return () => {
      stopPresenting();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  // Present mode ended some other way (Exit presentation, leaving fullscreen): close with it.
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
    const id = setInterval(
      () => {
        refreshRef.current?.();
        setTick((t) => ({ now: Date.now(), n: t.n + 1 }));
      },
      Math.max(5_000, refreshMs)
    );
    return () => clearInterval(id);
  }, [open, refreshMs]);

  if (!open || typeof document === "undefined") return null;
  const content = typeof children === "function" ? children(tick) : children;
  return createPortal(
    <div
      data-wall-view
      role="dialog"
      aria-labelledby={headingId}
      className="fixed inset-0 z-[90] overflow-y-auto overflow-x-hidden bg-bg text-text"
    >
      <div className="mx-auto flex min-h-full max-w-[120rem] flex-col gap-6 px-4 py-6 sm:px-10 sm:py-8">
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
        <div
          data-wall-content
          className="pointer-events-none flex-1 select-none text-xl sm:text-2xl"
        >
          {content}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** The tiles the wall shows, in this order, when the cockpit has them. */
export const WALL_TILES: readonly Tile["id"][] = [
  "committed",
  "done",
  "remaining",
  "gap",
  "finish",
  "blockers",
  "interrupts",
];

/**
 * What the wall shows: where the sprint is in its days, the verdict, the
 * goal check with its reasons, the main numbers and the next ceremony.
 */
export function CockpitWallContent({
  dayLine,
  goal,
  verdict,
  risk,
  tiles,
  next,
  now,
}: {
  /** "Day 5 of 14 · 9 days left". */
  dayLine: string;
  goal?: string;
  verdict: string;
  risk: SprintRisk;
  tiles: readonly Tile[];
  next: CeremonyOccurrence | undefined;
  now: Date;
}) {
  const shown = WALL_TILES.map((id) => tiles.find((t) => t.id === id)).filter((t): t is Tile =>
    Boolean(t)
  );
  const atRisk = risk.level === "at_risk";
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="font-data text-sub">{dayLine}</p>
        {goal && <p className="text-2xl font-semibold sm:text-4xl">Goal: {goal}</p>}
        <p className="sm:text-3xl">{verdict}</p>
      </div>
      {risk.applies && (
        <div
          data-wall-risk={risk.level}
          className={cn(
            "rounded-xl border p-4 sm:p-6",
            atRisk
              ? "border-destructive/40 bg-destructive/5"
              : risk.level === "watch"
                ? "border-warning/40 bg-warning/5"
                : "border-success/40 bg-success/5"
          )}
        >
          <p className="font-semibold sm:text-3xl">
            {RISK_LEVEL_LABEL[risk.level]}: {risk.headline}
          </p>
          {risk.reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-6">
              {risk.reasons.slice(0, 3).map((r) => (
                <li key={r.id}>{r.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {shown.map((t) => (
            <StatCard
              key={t.id}
              label={t.label}
              value={t.value}
              unit={t.unit}
              hint={t.hint}
              tone={t.tone}
              className="h-full"
              valueClassName={t.empty ? "font-sans text-xl text-sub" : undefined}
            />
          ))}
        </div>
      )}
      {next && (
        <p className="text-sub">
          Next: <span className="text-text">{CEREMONY_LABEL[next.kind]}</span> ·{" "}
          {whenLabel(next.at, now)}
        </p>
      )}
    </div>
  );
}

/** The "Wall mode" button: opens the view in the same tick as the click, so fullscreen is allowed. */
export function WallModeButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title="Show the sprint on a screen nobody touches, refreshing by itself"
      onClick={() => {
        startPresenting();
        onOpen();
      }}
    >
      <Tv aria-hidden="true" />
      Wall mode
    </Button>
  );
}
