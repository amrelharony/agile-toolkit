"use client";

import { useCallback, useSyncExternalStore } from "react";
import { timeTravelRegistry, type TimeTravelControls } from "./with-time-travel";

interface TimeTravelStatus {
  controls: TimeTravelControls | null;
  canUndo: boolean;
  canRedo: boolean;
  available: boolean;
  pastLength: number;
}

const EMPTY: TimeTravelStatus = {
  controls: null,
  canUndo: false,
  canRedo: false,
  available: false,
  pastLength: 0,
};

const EMPTY_KEY = "__empty__";

// Module-scope subscribe — stable across all hook calls so React doesn't
// re-subscribe on every render of every consumer.
const subscribeRegistry = (cb: () => void): (() => void) =>
  timeTravelRegistry.subscribe(cb);
const getServerSnapshot = (): string => EMPTY_KEY;

/**
 * React hook that subscribes to the time-travel controls for a given tool.
 *
 * Implementation: backed by `useSyncExternalStore` against the registry's
 * version counter. Re-renders only fire when the registry bumps (undo, redo,
 * snapshot, register/unregister) — not on every animation frame. This is a
 * meaningful CPU win compared to polling 60Hz.
 */
export function useTimeTravel(toolId: string | undefined): TimeTravelStatus {
  const getSnapshot = useCallback(() => {
    if (!toolId) return EMPTY_KEY;
    const controls = timeTravelRegistry.get(toolId);
    if (!controls) return `${toolId}|none|${timeTravelRegistry.getVersion()}`;
    // Encode the visible status into a string so React's identity check on
    // the snapshot reliably detects changes without us building a new object
    // every read (which would tear under concurrent rendering).
    return `${toolId}|${controls.canUndo()}|${controls.canRedo()}|${controls.pastLength()}|${timeTravelRegistry.getVersion()}`;
  }, [toolId]);

  // We only need React to know the snapshot identity changed; the actual
  // status object is derived below from the live registry.
  useSyncExternalStore(subscribeRegistry, getSnapshot, getServerSnapshot);

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
}
