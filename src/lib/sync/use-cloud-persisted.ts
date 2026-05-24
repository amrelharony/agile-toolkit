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
 * Remote pulls call `setSnapshot` via the adapter, which fans out to
 * every mounted hook for the key. The receiving hooks call `setState`,
 * which re-runs the write effect — that effect compares against
 * `remoteAppliedRef` (the value just applied) and SKIPS the push back
 * to Supabase. This prevents the echo loop where every remote arrival
 * round-trips back as a local edit.
 *
 * The key MUST be stable across renders. The sync registration happens
 * once per key; subsequent mounts with the same key reuse the existing
 * adapter (the registry is idempotent).
 */

// ──────── module-scoped state ────────

// Per-key set of subscribers used to fan remote-applied snapshots back
// to every mounted hook instance with the same key.
const subscribers = new Map<string, Set<(next: unknown) => void>>();

// Per-key cached current snapshot — the adapter's getSnapshot reads this
// when no hook is mounted, and the adapter's setSnapshot writes through it.
const snapshots = new Map<string, unknown>();

// Per-key adapter markDirty callback. The hook's write effect looks up
// this single function rather than maintaining per-instance listener Sets
// — that pattern previously captured a dead ref on first-hook unmount.
const adapterDirty = new Map<string, () => void>();

// Per-key registration flag so the registerBlobStore side-effect runs
// exactly once even when many components mount the same key.
const registered = new Set<string>();

function notifySubs(key: string, next: unknown): void {
  const subs = subscribers.get(key);
  if (!subs) return;
  subs.forEach((sub) => sub(next));
}

// Sentinel used by the write effect to detect "this state value was just
// applied from a remote pull" — we then skip both the redundant
// localStorage write (setSnapshot already wrote it) AND the markDirty
// push-back (would create an echo loop).
const NO_REMOTE = Symbol("no-remote-apply");

/**
 * Clear ALL per-key adapter state when a user signs out, so a subsequent
 * sign-in (potentially a different user on the same browser) doesn't see
 * the previous user's snapshots and accidentally upload them to the new
 * user's row. (BUG-S6)
 *
 * Called from the sync provider on auth state change. The hooks
 * themselves re-hydrate from localStorage on their next mount cycle.
 */
export function resetCloudPersistedRegistry(): void {
  subscribers.clear();
  snapshots.clear();
  adapterDirty.clear();
  registered.clear();
}

export function useCloudPersisted<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const initialRef = useRef(initial);
  const remoteAppliedRef = useRef<unknown>(NO_REMOTE);

  // Hydrate from localStorage and subscribe to remote-apply fan-out.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const sub = (next: unknown) => {
      if (cancelled) return;
      // Mark this value as remote-sourced so the write effect skips
      // the push-back. Reference identity is the contract.
      remoteAppliedRef.current = next;
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

    // Register the sync adapter once per key. The setSnapshot path stores
    // the new value into the module snapshot map and fans it to every
    // mounted hook — but does NOT write localStorage here; each receiving
    // hook's write effect writes localStorage exactly once.
    if (!registered.has(key)) {
      registered.add(key);
      registerBlobStore({
        storeKey: key,
        getSnapshot: () => snapshots.get(key) ?? null,
        setSnapshot: (next) => {
          snapshots.set(key, next);
          notifySubs(key, next);
        },
        subscribe: (onChange) => {
          // Store the adapter's markDirty in a module map so every mounted
          // hook for this key can fire it from its write effect (the prior
          // per-hook Set captured a stale ref on first-hook unmount).
          adapterDirty.set(key, onChange);
          return () => adapterDirty.delete(key);
        },
      });
    }

    return () => {
      cancelled = true;
      subs?.delete(sub);
    };
  }, [key]);

  // Write to localStorage + notify peers + ping the adapter. The
  // remoteAppliedRef sentinel short-circuits both writes and the
  // markDirty when the state change was sourced from a remote pull.
  useEffect(() => {
    if (hydratedKey !== key) return;
    if (typeof window === "undefined") return;
    if (state === remoteAppliedRef.current) {
      // This state arrived via the remote-apply sub. setSnapshot stored
      // it in the module snapshot map already; another mounted hook's
      // write effect will handle the localStorage write. Reset the
      // sentinel so a SUBSEQUENT local edit isn't mistakenly skipped.
      remoteAppliedRef.current = NO_REMOTE;
      return;
    }
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
    // they re-render with the new value. They re-enter via `sub` which
    // sets their own remoteAppliedRef sentinel, suppressing echo.
    notifySubs(key, state);
    // Trigger the adapter's debounced push.
    const dirty = adapterDirty.get(key);
    if (dirty) dirty();
  }, [key, state, hydratedKey]);

  return [state, setState];
}
