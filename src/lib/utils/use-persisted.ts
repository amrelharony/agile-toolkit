"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Persists state to localStorage under `key` without the empty-first-render
 * write-then-wipe race that a naive useEffect pair has.
 *
 * Safe across SSR: returns `initial` on the server, loads in a post-mount effect.
 *
 * R11-fix: previously, corruption / quota errors were silently swallowed,
 * leading to "the tool reset itself" with no signal to dev or user. We
 * now warn loudly via console.warn so the failure shows up in DevTools
 * even though it doesn't surface in the UI. Production users continue
 * to fall back to defaults rather than crash.
 */
export function usePersisted<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        setState(JSON.parse(raw) as T);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[usePersisted] failed to parse "${key}" — falling back to initial state.`, err);
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[usePersisted] failed to write "${key}" (quota / disabled?).`, err);
    }
  }, [key, state, hydrated]);

  return [state, setState];
}
