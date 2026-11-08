"use client";

import { dispatch } from "./engine";
import { ingestToolVisit } from "./ledger";
import { installOutcomeBridge } from "./outcome-bridge";
import { getToolByPath } from "@/lib/constants/tools";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { useHistoryStore } from "@/lib/history/history-store";

/**
 * Bridges app state into the gamification engine: the history log (finished
 * work → outcome XP, retro formats used) and tool visits.
 *
 * It listens to no input at all. Clicks, hovers, keys, scrolling and time on
 * site used to reach the engine from here; they are not outcomes, so they no
 * longer earn anything or cost a store write. Tool events still arrive
 * through sonification `emit()` and the ledger. Route changes come from the
 * provider's `usePathname` (see trackPathVisit) instead of patching
 * `history.pushState`.
 */

let installed = false;
let detach: (() => void) | null = null;

export function installEventBridge(): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (installed) return () => detach?.();
  installed = true;

  // --- retro formats used ---------------------------------------------------
  // `retro-all-formats` reads counters["retro-formats-used"]. Format switches
  // don't emit a sonification event — the only record is the history log
  // (retro-client logs FORMAT_CHANGED with { format }). Derive the
  // distinct-format count from there. Replayed cloud events are safe here: a
  // distinct-format SET is idempotent under replay, unlike XP, so counting
  // from synced history can't double-award.
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

  // --- finished work in the history log → outcome XP ----------------------
  const detachOutcomes = installOutcomeBridge();

  detach = () => {
    unsubHistory();
    detachOutcomes();
    installed = false;
  };
  return detach;
}

let lastVisitedPath: string | null = null;

/**
 * Record a visit when the route lands on a tool page. Called by the provider
 * with `usePathname()` on mount and on every navigation. The same path twice
 * in a row (a re-render, a remount) counts once; leaving and coming back
 * counts again, as a route change always did.
 */
export function trackPathVisit(pathname: string | null | undefined): void {
  if (typeof window === "undefined" || !pathname) return;
  if (pathname === lastVisitedPath) return;
  lastVisitedPath = pathname;
  const toolId = extractToolId(pathname);
  if (toolId) ingestToolVisit(toolId);
}

/** Test-only: forget the last visited path. */
export function __resetPathVisitForTests(): void {
  lastVisitedPath = null;
}

export function extractToolId(pathname: string): string | null {
  // Paths look like `/planning-poker`, `/burndown`, `/` (home), etc.
  const match = pathname.match(/^\/([a-z0-9-]+)\/?$/);
  if (!match) return null;
  // Validate against the tool registry — mirroring RecentToolTracker in
  // tool-prefs.ts. The shape test alone accepted EVERY single-segment route,
  // so /history, /insights, /guest and /not-authorized counted as tool
  // visits: 5 XP each, plus inflated `tool-hop-5/20/42` ("Visit all 42
  // tools") progress from pages that aren't tools.
  const tool = getToolByPath(`/${match[1]}`);
  // A VIP tool's address may only show a lock panel, and locked-in-a-book tools
  // shouldn't count towards "visit every tool" trophies anyone can earn.
  return tool && tool.access !== "vip" ? tool.id : null;
}
