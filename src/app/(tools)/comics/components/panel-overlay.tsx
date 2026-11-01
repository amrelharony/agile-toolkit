"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useInertSiblings } from "@/hooks/use-inert-siblings";
import { panelImageUrl } from "@/lib/comics/images";
import type { Panel } from "@/lib/comics/types";
import { PanelTranscript } from "./panel-transcript";

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
 */
export function PanelOverlay({ panels, index, title, onClose, onMove }: PanelOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panel = panels[index];
  const hasPrevious = index > 0;
  const hasNext = index < panels.length - 1;

  const moveBy = (step: -1 | 1) => {
    const to = index + step;
    if (to >= 0 && to < panels.length) onMove(to);
  };

  useBodyScrollLock(true);
  useInertSiblings(overlayRef, true);
  useFocusTrap(overlayRef, { active: true, initialFocusRef: closeRef });

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
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto"
        style={{ touchAction: "pan-x pan-y pinch-zoom" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={panel.pathFull}
          src={panelImageUrl(panel.pathFull)}
          width={panel.width}
          height={panel.height}
          alt={panel.alt}
          decoding="async"
          className="h-auto max-h-full w-auto max-w-full object-contain"
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
