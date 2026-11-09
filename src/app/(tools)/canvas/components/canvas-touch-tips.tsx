"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** Set once the tips have shown on this device (cleared by "Clear data"). */
export const TOUCH_TIPS_SEEN_KEY = "agile-toolkit:canvas-touch-tips-seen";

/** How long the tips stay up, once on screen, unless dismissed first. */
export const TOUCH_TIPS_MS = 15_000;

/** Share of the card that must be on screen before it counts as seen. */
const SEEN_RATIO = 0.5;

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

function rememberSeen() {
  try {
    window.localStorage.setItem(TOUCH_TIPS_SEEN_KEY, "1");
  } catch {
    // Ignore: the tips just show again on the next visit.
  }
}

/**
 * First-visit touch tips, shown inside the board under its top toolbar
 * and the tag filter row — clear of the tool rail, the zoom bar, Amr and
 * the empty-board card, which the old bottom toast covered. The card
 * lets every touch through to the board except on its own dismiss button.
 *
 * On a phone the board often starts below the fold (the page header and
 * intro come first), so the tips only count as seen — the device flag
 * written and the 15 s countdown started — once the card is actually on
 * screen. Until then they wait.
 */
export function CanvasTouchTips({ enabled, readOnly }: { enabled: boolean; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    try {
      if (window.localStorage.getItem(TOUCH_TIPS_SEEN_KEY) === "1") return;
    } catch {
      // Storage blocked (private mode): skip the tips rather than show
      // them on every visit.
      return;
    }
    setOpen(true);
  }, [enabled]);

  // Wait for the card to be on screen before it counts as seen.
  useEffect(() => {
    if (!open || onScreen) return;
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // A hair under the threshold: browsers can report 0.4999 as
        // the card crosses it.
        const seen = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= SEEN_RATIO - 0.01
        );
        if (seen) setOnScreen(true);
      },
      { threshold: SEEN_RATIO }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, onScreen]);

  // Seen: remember it for this device and start the countdown.
  useEffect(() => {
    if (!open || !onScreen) return;
    rememberSeen();
    const timer = window.setTimeout(() => setOpen(false), TOUCH_TIPS_MS);
    return () => window.clearTimeout(timer);
  }, [open, onScreen]);

  if (!open) return null;
  return (
    <div
      role="note"
      aria-label="Touch tips"
      data-canvas-export-ignore="true"
      // 7.5rem starts below the board toolbar and the tag filter row
      // (shown on tagged boards), so neither covers the card or its
      // dismiss button. On touch that row starts at 68-72 px and is up
      // to 46 px tall (its 44 px clear-filter button), so it ends by
      // 118 px. Below sm the tool rail runs down the left edge, so start
      // past it.
      className="pointer-events-none absolute top-[7.5rem] left-[4.5rem] right-3 z-[6] flex justify-center sm:left-3"
    >
      <div
        ref={cardRef}
        className="flex max-w-sm items-start rounded-lg border border-border bg-surface/95 pl-3 shadow-lg backdrop-blur-sm"
      >
        <p className="py-3 text-xs text-text">{touchTipsCopy(readOnly)}</p>
        <button
          type="button"
          onClick={() => {
            rememberSeen();
            setOpen(false);
          }}
          aria-label="Dismiss touch tips"
          className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sub hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
