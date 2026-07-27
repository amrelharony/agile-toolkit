"use client";

import { dispatch } from "./engine";
import { getToolByPath } from "@/lib/constants/tools";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { useHistoryStore } from "@/lib/history/history-store";

/**
 * Bridges existing app events into the gamification engine.  Uses global
 * listeners + a tap into the sonification emit pipeline.  Zero per-component
 * edits.
 */

let installed = false;
let detach: (() => void) | null = null;

export function installEventBridge(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (installed) return () => detach?.();
  installed = true;

  // --- clicks (any interactive element) -------------------------------------
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const el = target.closest<HTMLElement>(
      "button, a, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='switch'], [role='checkbox'], [data-slot='trigger']"
    );
    if (!el) return;
    dispatch({ name: "click" });
  };

  // --- hovers (passive XP drip) --------------------------------------------
  const hoverMap = new WeakMap<Element, number>();
  const onPointerOver = (e: PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const el = target.closest<HTMLElement>(
      "button, a, [role='button'], input, textarea, [data-sonify-hover]"
    );
    if (!el) return;
    const now = performance.now();
    const last = hoverMap.get(el) ?? 0;
    if (now - last < 500) return; // per-element slow drip
    hoverMap.set(el, now);
    dispatch({ name: "hover" });
  };

  // --- keys (Enter / Escape) -----------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Escape") {
      dispatch({ name: "key" });
    }
  };

  // --- scroll depth --------------------------------------------------------
  let rafId = 0;
  let reachedFloor = false;
  let floorResetTimer: number | undefined;
  const onScroll = () => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      const doc = document.documentElement;
      const scrollable = Math.max(1, doc.scrollHeight - window.innerHeight);
      const depth = window.scrollY / scrollable;
      if (depth >= 0.95 && !reachedFloor) {
        reachedFloor = true;
        dispatch({ name: "scroll-floor" });
        // reset after 10s so multiple pages can each trigger it.
        floorResetTimer = window.setTimeout(() => {
          reachedFloor = false;
          floorResetTimer = undefined;
        }, 10_000);
      }
    });
  };

  // --- route change → tool visit ------------------------------------------
  let lastPath = window.location.pathname;
  const onPathCheck = () => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      const toolId = extractToolId(lastPath);
      if (toolId) dispatch({ name: "tool-visit", meta: { toolId } });
    }
  };
  // Patch history API to catch client-side navigations.
  const origPush = window.history.pushState;
  const origReplace = window.history.replaceState;
  window.history.pushState = function (...args) {
    const result = origPush.apply(this, args);
    onPathCheck();
    return result;
  };
  window.history.replaceState = function (...args) {
    const result = origReplace.apply(this, args);
    onPathCheck();
    return result;
  };
  window.addEventListener("popstate", onPathCheck);
  // Fire once for initial page.
  const initialTool = extractToolId(window.location.pathname);
  if (initialTool) dispatch({ name: "tool-visit", meta: { toolId: initialTool } });

  // --- session minute ticker ----------------------------------------------
  // R10: gate on document.visibilityState. A backgrounded tab previously
  // racked up "session minutes" for time the user wasn't actually using
  // the app, inflating the marathon counters (which now actually bump
  // since R9). Skip ticks while hidden.
  const minuteTimer = window.setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    dispatch({ name: "session-minute" });
  }, 60_000);

  // --- sonification modes tried --------------------------------------------
  // `audio-modes` reads counters["audio-modes-used"], which nothing ever
  // wrote (same dead-counter class as the hover-hundred fix in engine.ts).
  // No event fires on a mode change, so watch the sonification store
  // directly and count DISTINCT modes via a per-mode marker counter.
  // Subscription-only (no synchronous seed): the store uses skipHydration,
  // so getState() at install time still holds defaults — rehydrate itself
  // notifies subscribers, at which point we mark the user's real mode.
  const markAudioMode = () => {
    const prefs = useSonificationStore.getState();
    if (!prefs.enabled) return; // "trying" a mode requires audio on
    const key = `audio-mode:${prefs.mode}`;
    const counters = useVDnaStore.getState().counters;
    if ((counters[key] ?? 0) > 0) return;
    useVDnaStore.getState().bumpCounter(key, 1);
    useVDnaStore.getState().bumpCounter("audio-modes-used", 1);
    // Nudge the engine so the achievement unlocks now rather than on the
    // next unrelated interaction.
    dispatch({ name: "audio-mode-used", meta: { mode: prefs.mode } });
  };
  const unsubSonification = useSonificationStore.subscribe(markAudioMode);

  // --- retro formats used ---------------------------------------------------
  // `retro-all-formats` reads counters["retro-formats-used"], also never
  // written. Format switches don't emit a sonification event — the only
  // record is the history log (retro-client logs FORMAT_CHANGED with
  // { format }). Derive the distinct-format count from there. Replayed
  // cloud events are safe here: a distinct-format SET is idempotent under
  // replay, unlike XP, so counting from synced history can't double-award.
  const syncRetroFormats = () => {
    const events = useHistoryStore.getState().events;
    const distinct = new Set<string>();
    for (const e of events) {
      if (e.toolId !== "retro" || e.action !== "format_changed") continue;
      const format = (e.payload as { format?: unknown } | undefined)?.format;
      if (typeof format === "string" && format) distinct.add(format);
    }
    const seen = useVDnaStore.getState().counters["retro-formats-used"] ?? 0;
    if (distinct.size > seen) {
      useVDnaStore.getState().bumpCounter("retro-formats-used", distinct.size - seen);
      dispatch({ name: "retro-format-used" });
    }
  };
  const unsubHistory = useHistoryStore.subscribe((s, prev) => {
    if (s.events !== prev.events) syncRetroFormats();
  });
  syncRetroFormats();

  window.addEventListener("click", onClick, { passive: true });
  window.addEventListener("pointerover", onPointerOver, { passive: true });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onScroll, { passive: true });

  detach = () => {
    window.removeEventListener("click", onClick);
    window.removeEventListener("pointerover", onPointerOver);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("popstate", onPathCheck);
    window.history.pushState = origPush;
    window.history.replaceState = origReplace;
    window.clearInterval(minuteTimer);
    unsubSonification();
    unsubHistory();
    // Cancel pending RAF/timeout so they don't dispatch after the bridge is
    // torn down (HMR + provider remount used to leak duplicate handlers).
    if (rafId) window.cancelAnimationFrame(rafId);
    if (floorResetTimer !== undefined) window.clearTimeout(floorResetTimer);
    installed = false;
  };
  return detach;
}

function extractToolId(pathname: string): string | null {
  // Paths look like `/planning-poker`, `/burndown`, `/` (home), etc.
  const match = pathname.match(/^\/([a-z0-9-]+)\/?$/);
  if (!match) return null;
  // Validate against the tool registry — mirroring RecentToolTracker in
  // tool-prefs.ts. The shape test alone accepted EVERY single-segment route,
  // so /history, /insights, /guest and /not-authorized counted as tool
  // visits: 5 XP each, plus inflated `tool-hop-5/20/42` ("Visit all 42
  // tools") progress from pages that aren't tools.
  const tool = getToolByPath(`/${match[1]}`);
  return tool ? tool.id : null;
}

/**
 * Bridge into sonification emits so tool-specific sounds become gamification
 * events automatically: `sonify("retro", "card-add")` fires
 * `tool:retro:card-add` for the engine.
 *
 * We accomplish this by subscribing to the store-gated emit pipe via a
 * monkey-patch — but the simpler path is to expose a named dispatcher on
 * window and have tools call it directly where they already call sonify.
 * For zero-touch integration we call both from the same surfaces: existing
 * tool clients already call `emit(toolId, eventName)` from @/lib/sonification.
 * We hook those emits by forwarding them through a proxy layer below.
 */
