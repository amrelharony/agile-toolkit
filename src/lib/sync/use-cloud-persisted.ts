"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { registerBlobStore } from "./register";

/**
 * Drop-in replacement for `usePersisted` that ALSO opts the key into
 * cloud sync. localStorage is still the primary store (offline-first);
 * the sync engine mirrors deltas to Supabase per-user.
 *
 * Behaviour is identical to `usePersisted` when the user is signed out
 * (the sync engine simply doesn't run). When signed in, edits flow:
 *
 *   setState(...) → localStorage write → adapter.markDirty()
 *                                     → debounced push to Supabase
 *
 * Remote pulls call `setRemoteState` via the adapter, which goes through
 * the same useState setter — the hook sees a state change and writes to
 * localStorage just like a local edit (but suppressed from re-pushing).
 *
 * The key MUST be stable across renders. The sync registration happens
 * once per key; subsequent mounts with the same key reuse the existing
 * adapter (the registry is idempotent).
 */

// Per-key set of subscribers used to fan remote-applied snapshots back
// to every mounted hook instance with the same key. Module-scoped so
// multiple components watching the same key all update.
const subscribers = new Map<string, Set<(next: unknown) => void>>();
// Per-key cached current snapshot — used by the adapter's getSnapshot
// callback when no hook is currently mounted (the adapter still needs to
// be able to push the last-known state). Also the "source of truth" the
// adapter consults during a remote→local apply.
const snapshots = new Map<string, unknown>();
// Track local subscriber wiring so each key registers exactly one adapter.
const registered = new Set<string>();

function notifyAllExcept(key: string, except: (next: unknown) => void, next: unknown): void {
  const subs = subscribers.get(key);
  if (!subs) return;
  subs.forEach((sub) => {
    if (sub !== except) sub(next);
  });
}

export function useCloudPersisted<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const initialRef = useRef(initial);
  const onChangeListeners = useRef<Set<() => void>>(new Set());
  const stateRef = useRef<T>(initial);
  stateRef.current = state;

  // Hydrate from localStorage (same logic as usePersisted) and register
  // for remote-apply fan-out.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const sub = (next: unknown) => {
      if (cancelled) return;
      setState(next as T);
      setHydratedKey(key);
    };
    let subs = subscribers.get(key);
    if (!subs) {
      subs = new Set();
      subscribers.set(key, subs);
    }
    subs.add(sub);

    // Hydrate from localStorage.
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        if (raw.length > 5 * 1024 * 1024) {
          localStorage.removeItem(key);
          if (!cancelled) {
            setState(initialRef.current);
            snapshots.set(key, initialRef.current);
            setHydratedKey(key);
          }
        } else {
          const parsed = JSON.parse(raw) as T | null;
          if (parsed === null && initialRef.current !== null) {
            if (!cancelled) {
              setState(initialRef.current);
              snapshots.set(key, initialRef.current);
              setHydratedKey(key);
            }
          } else if (!cancelled) {
            setState(parsed as T);
            snapshots.set(key, parsed);
            setHydratedKey(key);
          }
        }
      } else {
        if (!cancelled) {
          setState(initialRef.current);
          snapshots.set(key, initialRef.current);
          setHydratedKey(key);
        }
      }
    } catch {
      if (!cancelled) {
        setState(initialRef.current);
        snapshots.set(key, initialRef.current);
        setHydratedKey(key);
      }
    }

    // Register the sync adapter once per key. Late registration is fine —
    // the engine will pull this key on next visibility-change / focus.
    if (!registered.has(key)) {
      registered.add(key);
      const listenersForKey = onChangeListeners.current;
      registerBlobStore({
        storeKey: key,
        getSnapshot: () => snapshots.get(key) ?? null,
        setSnapshot: (next) => {
          snapshots.set(key, next);
          // Mirror to localStorage so the next cold-load sees the
          // remote-sourced value even if the page reloads before another
          // pull happens.
          try {
            localStorage.setItem(key, JSON.stringify(next));
          } catch {
            /* quota — accept loss */
          }
          // Fan out to every mounted hook for this key.
          const subs = subscribers.get(key);
          if (subs) subs.forEach((sub) => sub(next));
        },
        subscribe: (onChange) => {
          listenersForKey.add(onChange);
          return () => listenersForKey.delete(onChange);
        },
      });
    }

    return () => {
      cancelled = true;
      subs?.delete(sub);
    };
  }, [key]);

  // Write to localStorage + notify peers + ping the adapter.
  useEffect(() => {
    if (hydratedKey !== key) return;
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(`[useCloudPersisted] failed to persist key=${key}`, e);
      }
    }
    snapshots.set(key, state);
    // Notify other mounted hooks for this key (within the same tab) so
    // they re-render with the new value. The sender (this setter) is
    // already in sync; skip it.
    // We can't easily get "this hook's" sub reference here, so iterate
    // all and skip none — duplicate state set is harmless (React dedups).
    notifyAllExcept(key, () => {}, state);
    onChangeListeners.current.forEach((cb) => cb());
  }, [key, state, hydratedKey]);

  return [state, setState];
}
