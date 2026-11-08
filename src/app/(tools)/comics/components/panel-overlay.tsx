"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useInertSiblings } from "@/hooks/use-inert-siblings";
import { panelImageUrl } from "@/lib/comics/images";
import type { Panel } from "@/lib/comics/types";
import { PanelTranscript } from "./panel-transcript";
import { useSwipe } from "./use-swipe";

interface PanelOverlayProps {
  panels: readonly Panel[];
  index: number;
  title: string;
  onClose: () => void;
  onMove: (index: number) => void;
}

/**
 * One panel at 1536 px, over everything, the only place that larger file is
 * loaded. Zoom is the browser's own pinch: the page stays zoomable, and
 * touch-action below keeps the gesture ours to give. No JS zoom and no
 * Fullscreen API, which iPhones don't have anyway.
 *
 * On a phone held upright a panel fitted to the width is barely bigger than the
 * one in the page, so there it fills the height instead and pans sideways. A
 * sideways swipe moves between panels once the panel has been panned to that
 * edge, and only at the page's own size, so it never fights a pinch.
 */
export function PanelOverlay({ panels, index, title, onClose, onMove }: PanelOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panel = panels[index];
  const hasPrevious = index > 0;
  const hasNext = index < panels.length - 1;

  const moveBy = (step: -1 | 1) => {
    const to = index + step;
    if (to >= 0 && to < panels.length) onMove(to);
  };

  const swipe = useSwipe(moveBy, () => {
    const el = scrollerRef.current;
    if (!el) return { back: true, on: true };
    return {
      back: el.scrollLeft <= 1,
      on: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    };
  });

  useBodyScrollLock(true);
  useInertSiblings(overlayRef, true);
  useFocusTrap(overlayRef, { active: true, initialFocusRef: closeRef });

  // Each panel starts at its beginning, where its first words are, before it
  // paints.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = 0;
    el.scrollTop = 0;
  }, [index]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onMove(index - 1);
      else if (e.key === "ArrowRight" && index < panels.length - 1) onMove(index + 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, panels.length, onClose, onMove]);

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}: panel ${index + 1} of ${panels.length}`}
      className="fixed inset-0 z-[200] flex flex-col bg-surface-deep pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-2">
        <p className="px-2 text-sm text-sub">
          Panel {index + 1} of {panels.length}
        </p>
        <div className="flex items-center gap-1">
          {/* aria-disabled, not disabled: pressing Next up to the last panel
              must leave focus on the button, not drop it out of the dialog. */}
          <IconButton
            label="Previous panel"
            icon={<ChevronLeft aria-hidden="true" />}
            tooltip={false}
            aria-disabled={!hasPrevious}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => moveBy(-1)}
          />
          <IconButton
            label="Next panel"
            icon={<ChevronRight aria-hidden="true" />}
            tooltip={false}
            aria-disabled={!hasNext}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => moveBy(1)}
          />
          <IconButton
            ref={closeRef}
            label="Close"
            icon={<X aria-hidden="true" />}
            tooltip={false}
            onClick={onClose}
          />
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="flex min-h-0 flex-1 overflow-auto"
        style={{ touchAction: "pan-x pan-y pinch-zoom" }}
        {...swipe}
      >
        {/* m-auto centres the panel while it fits and, unlike centring the
            row, lets a wider one scroll from its left edge instead of cutting
            that edge off. Upright phones: the height filled, the width free. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={panel.pathFull}
          src={panelImageUrl(panel.pathFull)}
          width={panel.width}
          height={panel.height}
          alt={panel.alt}
          decoding="async"
          className="m-auto h-auto max-h-full w-auto max-w-full object-contain max-sm:portrait:h-full max-sm:portrait:max-w-none max-sm:portrait:shrink-0"
        />
      </div>
      {/* The page behind is inert while this is open, so the words come along. */}
      <div className="sr-only">
        <PanelTranscript panel={panel} />
      </div>
    </div>,
    document.body
  );
}
