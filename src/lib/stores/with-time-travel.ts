"use client";

import type { StateCreator } from "zustand";

/**
 * Time-travel middleware for Zustand stores.
 *
 * Wraps a state creator with in-memory `_past` / `_future` snapshot stacks.
 * Each external mutation snapshots the previous state into `_past`; `_future`
 * is cleared on a fresh write and rebuilt by `undo()`.
 *
 * The middleware is opt-in per tool. State excluded from time-travel (UI
 * widgets, scroll offsets, etc.) can be filtered via `excludeKeys`.
 *
 * Each wrapped store registers itself in a global `timeTravelRegistry` keyed
 * by `toolId`, so the global keyboard handler and the history drawer can
 * drive undo/redo without prop-drilling. The internal stack state is hidden
 * from the public store type, so callers don't see `_ttPast` etc.
 *
 * Performance:
 *   - No-op detection uses shallow reference equality on top-level keys
 *     instead of JSON.stringify — O(k) instead of O(state size).
 *   - The registry exposes a version counter so subscribers can rerender
 *     reactively instead of polling.
 */

const STACK_CAP = 50;

export interface TimeTravelControls {
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Drop all history but keep current state. */
  clearHistory: () => void;
  /** Snapshot count — useful for restore-to-point math. */
  pastLength: () => number;
}

interface TimeTravelOptions<T> {
  /** Tool id (matches src/lib/constants/tools.ts) — used to register controls. */
  toolId: string;
  /** Keys NOT included in snapshots. Functions are excluded automatically. */
  excludeKeys?: (keyof T)[];
}

// ──────────────────────────────────────────────────────────────────────
// Global registry of controls, keyed by toolId.
//
// Notifies subscribers on:
//   - register / unregister (controls map mutated)
//   - any undo/redo/snapshot inside a registered store (version bumped)
// ──────────────────────────────────────────────────────────────────────

type Listener = () => void;

class TimeTravelRegistry {
  private map = new Map<string, TimeTravelControls>();
  private listeners = new Set<Listener>();
  private version = 0;

  register(toolId: string, controls: TimeTravelControls): () => void {
    // If a previous registration exists (HMR, store re-create), it's
    // implicitly replaced. Capturing & releasing the old reference would be
    // ideal but in practice the old store is no longer used; let GC reclaim.
    this.map.set(toolId, controls);
    this.bump();
    return () => {
      if (this.map.get(toolId) === controls) {
        this.map.delete(toolId);
        this.bump();
      }
    };
  }

  get(toolId: string): TimeTravelControls | undefined {
    return this.map.get(toolId);
  }

  has(toolId: string): boolean {
    return this.map.has(toolId);
  }

  /** Bumped on every state-affecting event in any registered store. */
  getVersion(): number {
    return this.version;
  }

  bump(): void {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const timeTravelRegistry = new TimeTravelRegistry();

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/** Internal-state field names. Exported so persist-helpers can strip them. */
export const TIME_TRAVEL_INTERNAL_KEYS = ["_ttPast", "_ttFuture"] as const;

function snapshot<T extends object>(obj: T, exclude: Set<string>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "function") continue;
    if (k.startsWith("_tt")) continue;
    if (exclude.has(k)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Shallow reference-equality on the snapshot's top-level keys. We rely on
 * the convention that all wrapped stores use immutable updates, so a
 * functionally unchanged state has the same array/object references.
 */
function shallowEqualSnapshot(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// ──────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────

export function withTimeTravel<T extends object>(
  options: TimeTravelOptions<T>,
  creator: StateCreator<T, [], [], T>
): StateCreator<T, [], [], T> {
  const { toolId, excludeKeys = [] } = options;
  const exclude = new Set<string>(excludeKeys.map(String));

  return ((set, get, api) => {
    let suppressSnapshot = false;

    type Internal = T & {
      _ttPast?: Partial<T>[];
      _ttFuture?: Partial<T>[];
    };

    const setRaw = set as unknown as (
      partial: Partial<Internal> | ((s: Internal) => Partial<Internal>),
      replace?: boolean
    ) => void;
    const getInternal = get as unknown as () => Internal;

    const wrappedSet = ((updater: unknown, replace?: boolean) => {
      if (suppressSnapshot) {
        setRaw(updater as Partial<Internal>, replace);
        return;
      }
      const prevSnap = snapshot(getInternal(), exclude) as Record<string, unknown>;
      setRaw(updater as Partial<Internal>, replace);
      const nextSnap = snapshot(getInternal(), exclude) as Record<string, unknown>;
      if (shallowEqualSnapshot(prevSnap, nextSnap)) return;
      const past = (getInternal()._ttPast ?? []).slice();
      past.push(prevSnap as Partial<T>);
      if (past.length > STACK_CAP) past.shift();
      setRaw({
        _ttPast: past,
        _ttFuture: [],
      } as Partial<Internal>);
      timeTravelRegistry.bump();
    }) as typeof set;

    const userSlice = creator(wrappedSet, get, api);

    const controls: TimeTravelControls = {
      undo: () => {
        const state = getInternal();
        const past = state._ttPast ?? [];
        if (past.length === 0) return false;
        const prev = past[past.length - 1];
        const newPast = past.slice(0, -1);
        const current = snapshot(state, exclude);
        const newFuture = [current, ...(state._ttFuture ?? [])];
        if (newFuture.length > STACK_CAP) newFuture.length = STACK_CAP;
        suppressSnapshot = true;
        try {
          setRaw({
            ...prev,
            _ttPast: newPast,
            _ttFuture: newFuture,
          } as Partial<Internal>);
        } finally {
          suppressSnapshot = false;
        }
        timeTravelRegistry.bump();
        return true;
      },
      redo: () => {
        const state = getInternal();
        const future = state._ttFuture ?? [];
        if (future.length === 0) return false;
        const next = future[0];
        const newFuture = future.slice(1);
        const current = snapshot(state, exclude);
        const newPast = [...(state._ttPast ?? []), current];
        if (newPast.length > STACK_CAP) newPast.shift();
        suppressSnapshot = true;
        try {
          setRaw({
            ...next,
            _ttPast: newPast,
            _ttFuture: newFuture,
          } as Partial<Internal>);
        } finally {
          suppressSnapshot = false;
        }
        timeTravelRegistry.bump();
        return true;
      },
      canUndo: () => (getInternal()._ttPast?.length ?? 0) > 0,
      canRedo: () => (getInternal()._ttFuture?.length ?? 0) > 0,
      pastLength: () => getInternal()._ttPast?.length ?? 0,
      clearHistory: () => {
        suppressSnapshot = true;
        try {
          setRaw({
            _ttPast: [],
            _ttFuture: [],
          } as Partial<Internal>);
        } finally {
          suppressSnapshot = false;
        }
        timeTravelRegistry.bump();
      },
    };

    timeTravelRegistry.register(toolId, controls);

    return {
      ...userSlice,
      _ttPast: [] as Partial<T>[],
      _ttFuture: [] as Partial<T>[],
    } as unknown as T;
  }) as StateCreator<T, [], [], T>;
}
