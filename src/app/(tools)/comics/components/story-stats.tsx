"use client";

import { useEffect } from "react";
import { addSeconds, hasRead, markViewed } from "@/lib/comics/reading";
import { ACTIVE_CAP_S, IDLE_AFTER_S, timeEvent } from "@/lib/comics/stats";
import { beaconStats } from "@/lib/comics/stats-client";
import { useCounting } from "./use-counting";

const IDLE_MS = IDLE_AFTER_S * 1000;
const INPUTS = ["scroll", "wheel", "pointerdown", "pointermove", "keydown", "touchstart"] as const;

/**
 * Counts one view of a weekly story (and this browser's first, as a visitor),
 * then measures active reading time: the tab is visible and someone has
 * scrolled, pointed, typed or touched within the last minute. When the page is
 * first hidden or left, one band of that time is counted (lib/comics/stats), at
 * most ten minutes. Time read after coming back still adds to the reader's own
 * total in Your reading, but isn't counted again. Renders nothing.
 */
export function StoryStats({ ep }: { ep: number }) {
  const counting = useCounting();

  useEffect(() => {
    if (!counting) return;
    // A story this browser read before the counts began is a returning reader:
    // counting it as a new visitor, who can never become a reader again, would
    // pull its finishing rate down.
    const firstView = markViewed(ep) && !hasRead(ep);
    beaconStats(ep, firstView ? ["view", "visitor"] : ["view"]);

    const visible = () => document.visibilityState === "visible";
    let activeMs = 0;
    let keptMs = 0;
    let lastInput = Date.now();
    let since: number | null = visible() ? lastInput : null;
    let reported = false;

    // Adds the running stretch, up to a minute past the last input.
    const flush = (now: number) => {
      if (since === null) return;
      const end = Math.min(now, lastInput + IDLE_MS);
      if (end > since) activeMs += end - since;
      since = now - lastInput < IDLE_MS ? now : null;
    };
    const onInput = () => {
      const now = Date.now();
      flush(now);
      lastInput = now;
      if (since === null && visible()) since = now;
    };
    const settle = () => {
      flush(Date.now());
      since = null;
      const capped = Math.min(activeMs, ACTIVE_CAP_S * 1000);
      if (capped > keptMs) addSeconds(ep, (capped - keptMs) / 1000);
      keptMs = capped;
      if (!reported) {
        reported = true;
        beaconStats(ep, [timeEvent(capped / 1000)]);
      }
    };
    const onVisibility = () => {
      if (!visible()) {
        settle();
        return;
      }
      lastInput = Date.now();
      since = lastInput;
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", settle);
    for (const name of INPUTS) window.addEventListener(name, onInput, { passive: true });
    return () => {
      // Leaving for another page inside the site never hides the tab.
      settle();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", settle);
      for (const name of INPUTS) window.removeEventListener(name, onInput);
    };
  }, [ep, counting]);

  return null;
}
