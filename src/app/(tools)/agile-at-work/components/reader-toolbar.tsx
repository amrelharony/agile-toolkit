"use client";

import { forwardRef, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  RectangleVertical,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { pageLabel, viewFor } from "@/lib/comic/reader-math";
import { cn } from "@/lib/utils";
import { DownloadPdfButton } from "./comic-status";

export type LayoutMode = "auto" | "single" | "spread";

// aria-disabled rather than `disabled` on Prev/Next: a disabled button
// drops keyboard focus to <body> the moment the reader reaches either end.
// Clicking one at the end is a no-op (the view can't move further).
// Opacity modifiers (bg-accent/15) emit nothing for the var() colours in
// this Tailwind setup, so the selected segment uses the --glow tokens,
// which every theme (dark, light, high-contrast) tints for its accent.
const SEGMENT_ON =
  "bg-[var(--glow)] font-semibold text-accent shadow-[inset_0_0_0_1px_var(--glowS)]";

const NAV_BUTTON =
  "h-11 w-11 md:h-11 md:w-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const LAYOUT_OPTIONS: { mode: LayoutMode; label: string; title: string; icon: LucideIcon }[] = [
  {
    mode: "auto",
    label: "Auto",
    title: "Auto: two-page spreads when the screen is wide enough",
    icon: Sparkles,
  },
  { mode: "single", label: "Single", title: "One page at a time", icon: RectangleVertical },
  { mode: "spread", label: "Spread", title: "Two-page spreads", icon: BookOpen },
];

interface ReaderToolbarProps {
  /** 0 while the PDF is still opening. */
  numPages: number;
  view: readonly number[];
  spread: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (page: number) => void;
  mode: LayoutMode;
  onModeChange: (mode: LayoutMode) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  src: string;
  size: number | null;
}

/**
 * Prev/Next, the page label, a page scrubber, the layout toggle,
 * fullscreen and Download.
 *
 * Hints are `title` + `aria-label`, not Radix tooltips: tooltips portal
 * into <body>, which is not rendered while the reader is in native
 * fullscreen. At phone width the controls wrap into three rows (nav,
 * scrubber, then layout / fullscreen / download) of 44 px targets; from
 * `sm` the nav and the buttons share a row above the scrubber, and from
 * `md` everything fits on one line where there is room.
 */
export const ReaderToolbar = forwardRef<HTMLButtonElement, ReaderToolbarProps>(
  function ReaderToolbar(
    {
      numPages,
      view,
      spread,
      onPrev,
      onNext,
      onGoTo,
      mode,
      onModeChange,
      isFullscreen,
      onToggleFullscreen,
      src,
      size,
    },
    fullscreenButtonRef
  ) {
    // Page under the scrubber thumb while dragging; committed on release.
    const [preview, setPreview] = useState<number | null>(null);
    // A pointer drag is in progress. Only drags preview: for keyboard steps
    // (arrows, Home/End, PageUp/PageDown) Radix calls onValueCommit BEFORE
    // onValueChange, so a preview set there would outlive its commit and
    // freeze the label, the thumb and aria-valuetext on that page.
    const draggingRef = useRef(false);
    const ready = numPages > 0;
    const shownView = preview !== null && ready ? viewFor(preview, numPages, spread) : view;
    const label = ready ? pageLabel(shownView, numPages) : "Loading…";
    const canPrev = ready && view[0] > 1;
    const canNext = ready && view[view.length - 1] < numPages;

    return (
      <div
        role="group"
        aria-label="Comic reader controls"
        className="flex flex-wrap items-center gap-x-3 gap-y-2"
      >
        <div className="flex basis-full items-center justify-between gap-1 sm:basis-auto">
          <Button
            variant="outline"
            size="icon"
            className={NAV_BUTTON}
            onClick={onPrev}
            aria-disabled={!canPrev}
            aria-label="Previous page"
            title="Previous page (←)"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="min-w-[9.5rem] px-2 text-center font-mono text-xs tabular-nums text-sub sm:text-sm">
            {label}
          </span>
          <Button
            variant="outline"
            size="icon"
            className={NAV_BUTTON}
            onClick={onNext}
            aria-disabled={!canNext}
            aria-label="Next page"
            title="Next page (→)"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        {ready && numPages > 1 && (
          <div className="basis-full px-2 sm:order-last md:order-none md:min-w-[8rem] md:flex-1 md:basis-0">
            <Slider
              min={1}
              max={numPages}
              step={1}
              value={[preview ?? view[0]]}
              onPointerDown={() => {
                draggingRef.current = true;
              }}
              onKeyDown={() => {
                draggingRef.current = false;
              }}
              onValueChange={([page]) => {
                if (draggingRef.current) setPreview(page);
              }}
              onValueCommit={([page]) => {
                const dragged = draggingRef.current;
                draggingRef.current = false;
                setPreview(null);
                // The thumb sits on the view's FIRST page, so a keyboard step
                // forward inside a spread lands on the page already shown
                // (2 → 3 of "2–3") and goTo would be a no-op: move a whole
                // view instead. Stepping back lands on the previous view's
                // trailing page (4 → 3 of "2–3"); go through onPrev so the
                // view is anchored on its first page, as the Prev button does.
                if (!dragged && view.length > 1 && page === view[view.length - 1]) onNext();
                else if (!dragged && view.length > 1 && page === view[0] - 1) onPrev();
                else onGoTo(page);
              }}
              // Don't reset `draggingRef` here: Radix runs this handler before
              // its own slide-end, which is what commits the drag.
              onPointerUp={() => setPreview(null)}
              // Dragging can end outside the thumb without a commit on some
              // touch browsers; never leave a stale preview behind.
              onPointerCancel={() => {
                draggingRef.current = false;
                setPreview(null);
              }}
              thumbProps={{ "aria-label": "Go to page", "aria-valuetext": label }}
              // The shared Track's bg-primary/20 emits no CSS (opacity
              // modifiers don't apply to var() colours here), leaving the
              // unread part of the scrubber invisible. Tint it locally.
              className="[&>span:first-child]:bg-[var(--border)]"
            />
          </div>
        )}

        <div className="order-last flex flex-wrap items-center gap-2 sm:order-none sm:ml-auto">
          <div
            role="group"
            aria-label="Page layout"
            className="inline-flex overflow-hidden rounded-md border border-border bg-[var(--card)]"
          >
            {LAYOUT_OPTIONS.map(({ mode: option, label: optionLabel, title, icon: Icon }) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                title={title}
                onClick={() => onModeChange(option)}
                className={cn(
                  "inline-flex min-h-[42px] min-w-11 items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  mode === option ? SEGMENT_ON : "text-sub hover:bg-surface-hover hover:text-text"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {/* Icon-only on phones; the name stays available to AT. */}
                <span className="sr-only sm:not-sr-only">{optionLabel}</span>
              </button>
            ))}
          </div>
          <Button
            ref={fullscreenButtonRef}
            variant="outline"
            size="icon"
            className="h-11 w-11 md:h-11 md:w-11"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen (F)"}
          >
            {isFullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
          </Button>
          <DownloadPdfButton src={src} size={size} />
        </div>
      </div>
    );
  }
);
