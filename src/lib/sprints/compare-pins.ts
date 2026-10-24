"use client";

/**
 * Where Sprint Comparison keeps the sprints it shows side by side: this
 * browser's storage, as a plain JSON array of sprint ids under
 * `SPRINT_COMPARE_PINS_KEY`. The legacy-data migration writes the ids of
 * the sprints it moved there in the same format, so it must stay a bare
 * array (not a zustand persist envelope), and the hook re-reads it on every
 * render as well as on change, so a migration that finishes while the page
 * is open shows up without a reload.
 *
 * Only the reading and writing live here; which sprints to show when
 * nothing is stored is the tool's call (sprint-compare/pins.ts).
 */

import { useMemo, useSyncExternalStore } from "react";
import { SPRINT_COMPARE_PINS_KEY } from "./legacy-keys";

export const COMPARE_PINS_KEY = SPRINT_COMPARE_PINS_KEY;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** The stored value as written, or null when there is none (or storage is blocked). */
export function readComparePinsRaw(): string | null {
  try {
    return window.localStorage.getItem(COMPARE_PINS_KEY);
  } catch {
    return null;
  }
}

/** Parse a stored value: the ids it lists, or null when nothing usable is stored. */
export function parseComparePins(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return null;
  }
}

/** The stored pins, or null when nothing usable is stored. */
export function readComparePins(): string[] | null {
  return parseComparePins(readComparePinsRaw());
}

/** Save the pinned ids (a plain JSON array). */
export function writeComparePins(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(COMPARE_PINS_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode or full storage: the pins last until the page reloads */
  }
  emit();
}

/** Forget the stored pins, so the tool's default list applies again. */
export function clearComparePins(): void {
  try {
    window.localStorage.removeItem(COMPARE_PINS_KEY);
  } catch {
    /* nothing stored that we can reach */
  }
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === COMPARE_PINS_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The stored pins, following storage in this tab and others; null when nothing is stored. */
export function useStoredComparePins(): string[] | null {
  const raw = useSyncExternalStore(subscribe, readComparePinsRaw, () => null);
  return useMemo(() => parseComparePins(raw), [raw]);
}
