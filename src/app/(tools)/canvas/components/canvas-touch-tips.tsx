"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** Set once the tips have shown on this device (cleared by "Clear data"). */
export const TOUCH_TIPS_SEEN_KEY = "agile-toolkit:canvas-touch-tips-seen";

/** How long the tips stay up unless dismissed first. */
export const TOUCH_TIPS_MS = 15_000;

/**
 * The gestures the board really answers to on a touch screen (see
 * use-canvas-touch-gestures). Viewers get no actions menu, so their copy
 * leaves the long-press out.
 */
export function touchTipsCopy(readOnly: boolean): string {
  const tips = ["Pinch to zoom", "Drag with two fingers to pan"];
  if (!readOnly) tips.push("Long-press an item for actions");
  return tips.join(" · ");
}

/**
 * First-visit touch tips, shown inside the board under its top toolbar —
 * clear of the tool rail, the zoom bar, Amr and the empty-board card,
 * which the old bottom toast covered. The card lets every touch through
 * to the board except on its own dismiss button.
 */
export function CanvasTouchTips({ enabled, readOnly }: { enabled: boolean; readOnly: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    try {
      if (window.localStorage.getItem(TOUCH_TIPS_SEEN_KEY) === "1") return;
      window.localStorage.setItem(TOUCH_TIPS_SEEN_KEY, "1");
    } catch {
      // Storage blocked (private mode): skip the tips rather than show
      // them on every visit.
      return;
    }
    setOpen(true);
  }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), TOUCH_TIPS_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;
  return (
    <div
      role="note"
      aria-label="Touch tips"
      data-canvas-export-ignore="true"
      // Below sm the tool rail runs down the left edge, so start past it.
      className="pointer-events-none absolute top-[4.5rem] left-[4.5rem] right-3 z-[6] flex justify-center sm:left-3"
    >
      <div className="flex max-w-sm items-start rounded-lg border border-border bg-surface/95 pl-3 shadow-lg backdrop-blur-sm">
        <p className="py-3 text-xs text-text">{touchTipsCopy(readOnly)}</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Dismiss touch tips"
          className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sub hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
