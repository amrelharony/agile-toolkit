"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Persists state to localStorage under `key` without the empty-first-render
 * write-then-wipe race that a naive useEffect pair has.
 *
 * Safe across SSR: returns `initial` on the server, loads in a post-mount effect.
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
    } catch {
      // ignore corrupted JSON — fall back to initial state
    }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable — silently drop the save
    }
  }, [key, state, hydrated]);

  return [state, setState];
}
