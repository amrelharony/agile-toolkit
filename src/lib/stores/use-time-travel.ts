"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { timeTravelRegistry, type TimeTravelControls } from "./with-time-travel";

interface TimeTravelStatus {
  controls: TimeTravelControls | null;
  canUndo: boolean;
  canRedo: boolean;
  available: boolean;
  pastLength: number;
}

const EMPTY: TimeTravelStatus = Object.freeze({
  controls: null,
  canUndo: false,
  canRedo: false,
  available: false,
  pastLength: 0,
}) as TimeTravelStatus;

// Module-scope subscribe — stable across all hook calls so React doesn't
// re-subscribe on every render of every consumer.
const subscribeRegistry = (cb: () => void): (() => void) => timeTravelRegistry.subscribe(cb);

/**
 * React hook that subscribes to the time-travel controls for a given tool.
 *
 * Implementation: backed by `useSyncExternalStore` against the registry's
 * version counter. Re-renders only fire when the registry bumps (undo, redo,
 * snapshot, register/unregister) — not on every animation frame. This is a
 * meaningful CPU win compared to polling 60Hz.
 *
 * Tearing-safe: the snapshot string includes the canUndo/canRedo/pastLength
 * values, and the returned object is derived from the snapshot via useMemo
 * keyed on the snapshot itself — so a single render sees a single
 * snapshot-of-truth even under React 18 concurrent rendering.
 *
 * SSR-safe: `getServerSnapshot` returns the same shape as a not-yet-registered
 * tool on the client, so first paint matches and there's no hydration warning.
 */
export function useTimeTravel(toolId: string | undefined): TimeTravelStatus {
  const getSnapshot = useCallback(() => {
    if (!toolId) return "empty";
    const controls = timeTravelRegistry.get(toolId);
    // Deliberately EXCLUDE the global version counter. The registry bumps it
    // on every snapshot/undo/redo in ANY registered tool, so embedding it made
    // every useTimeTravel consumer re-render on unrelated tools' history
    // changes (e.g. a canvas edit re-rendering a workspace tool's undo chips).
    // This tool's own affordance is fully captured by canUndo|canRedo|
    // pastLength (which change whenever ITS stack changes) and by the
    // registered⇄none transition. The subscription still fires on every
    // version bump and re-reads this snapshot; returning a stable string when
    // nothing relevant to this tool changed lets useSyncExternalStore skip the
    // re-render.
    if (!controls) return `${toolId}|none`;
    return `${toolId}|${controls.canUndo()}|${controls.canRedo()}|${controls.pastLength()}`;
  }, [toolId]);

  // Match the not-registered shape so SSR and the first client render produce
  // the same string when controls haven't been registered yet.
  const getServerSnapshot = useCallback(() => {
    if (!toolId) return "empty";
    return `${toolId}|none`;
  }, [toolId]);

  const snapshot = useSyncExternalStore(subscribeRegistry, getSnapshot, getServerSnapshot);

  // Build the result object once per snapshot. This keeps the returned object
  // identity-stable across renders that share the same snapshot, and ensures
  // the returned values are derived from the SAME snapshot the subscribe
  // machinery saw (no tearing).
  return useMemo<TimeTravelStatus>(() => {
    if (!toolId) return EMPTY;
    const controls = timeTravelRegistry.get(toolId);
    if (!controls) return EMPTY;
    return {
      controls,
      canUndo: controls.canUndo(),
      canRedo: controls.canRedo(),
      available: true,
      pastLength: controls.pastLength(),
    };
    // snapshot is the cache key; controls / toolId are read from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, toolId]);
}
