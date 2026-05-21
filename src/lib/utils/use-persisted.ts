"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Persists state to localStorage under `key` without the empty-first-render
 * write-then-wipe race that a naive useEffect pair has.
 *
 * Key-change correctness: when `key` changes, the next render must NOT
 * write the *previous* key's state into the new key's slot. We track the
 * key in a ref and gate the write effect on `keyRef.current === key AND
 * hydratedKey === key` — i.e., the state we hold is known to belong to
 * the current key.
 *
 * Quota errors are surfaced via `console.warn` so they're at least
 * visible in dev; production users still get silent best-effort persistence.
 *
 * Safe across SSR: returns `initial` on the server, loads in a post-mount effect.
 */
export function usePersisted<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  // Track the initial value once so callers that pass a new object literal on
  // each render don't trigger a reset (useState already captures it on mount,
  // but we also need a stable reference for key-change reset below).
  const initialRef = useRef(initial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        // Cap read size so a malicious or corrupted slot can't freeze parse.
        if (raw.length > 5 * 1024 * 1024) {
          localStorage.removeItem(key);
          if (!cancelled) {
            setState(initialRef.current);
            setHydratedKey(key);
          }
          return;
        }
        const parsed = JSON.parse(raw) as T | null;
        // `JSON.parse("null")` returns null — only adopt as state if T is
        // nullable (we can't tell at runtime, so the caller's `initial` is
        // our safest default when null is parsed).
        if (parsed === null && initialRef.current !== null) {
          if (!cancelled) {
            setState(initialRef.current);
            setHydratedKey(key);
          }
          return;
        }
        if (!cancelled) {
          setState(parsed as T);
          setHydratedKey(key);
        }
      } else {
        // No persisted value: reset to current `initial` for this key so a
        // mid-session key change doesn't bleed prior data through.
        if (!cancelled) {
          setState(initialRef.current);
          setHydratedKey(key);
        }
      }
    } catch {
      // Corrupted JSON — fall back to initial state.
      if (!cancelled) {
        setState(initialRef.current);
        setHydratedKey(key);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    // Only write when the state we hold actually belongs to the current key.
    // Without this check, a key change of "a"→"b" would race: state still
    // holds "a"'s value until the read effect runs, and this write effect
    // would write that value into "b"'s slot, corrupting "b".
    if (hydratedKey !== key) return;
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      // Quota / serialization errors. Log in dev so caller notices; prod
      // accepts the lost save silently.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(`[usePersisted] failed to persist key=${key}`, e);
      }
    }
  }, [key, state, hydratedKey]);

  return [state, setState];
}
