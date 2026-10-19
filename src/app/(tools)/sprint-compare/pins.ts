"use client";

/**
 * Which shared sprints Sprint Comparison shows side by side (up to five).
 *
 * The list is this tool's own, kept in this browser as a plain JSON array of
 * sprint ids under `PINS_KEY`. The legacy-data migration writes the ids of
 * the sprints it moved here in the same format, so it must stay a bare array
 * (not a zustand persist envelope). With nothing stored, the tool shows the
 * newest rated sprints, so the list follows the data until the user pins or
 * unpins something.
 */

import { useMemo, useSyncExternalStore } from "react";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { seriesFor } from "@/lib/sprints/series";
import { SPRINT_COMPARE_PINS_KEY } from "@/lib/sprints/legacy-keys";

// One definition, shared with the migration that seeds it.
export const PINS_KEY = SPRINT_COMPARE_PINS_KEY;
export const MAX_PINS = 5;
/** How many unrated sprints the default shows when nothing is rated yet. */
const DEFAULT_UNRATED_PINS = 3;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** The stored value as written, or null when there is none (or storage is blocked). */
export function readPinsRaw(): string | null {
  try {
    return window.localStorage.getItem(PINS_KEY);
  } catch {
    return null;
  }
}

/** Parse a stored value: the ids it lists, or null when nothing usable is stored. */
export function parsePins(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return null;
  }
}

/** Save the pinned ids (a plain JSON array). */
export function writePins(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode or full storage: the pins last until the page reloads */
  }
  emit();
}

/** Forget the stored pins, so the default list applies again. */
export function clearPins(): void {
  try {
    window.localStorage.removeItem(PINS_KEY);
  } catch {
    /* nothing stored that we can reach */
  }
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PINS_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** True when the sprint has at least one rating. */
export function hasRatings(series: SprintSeries | undefined): boolean {
  return Object.values(series?.ratings ?? {}).some((v) => Number.isFinite(v));
}

/**
 * The default comparison: the five newest sprints that have ratings, else
 * the three newest sprints. `sprints` must be newest first.
 */
export function defaultPins(
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined
): string[] {
  const rated = sprints.filter((s) => hasRatings(seriesFor(series, s.id)));
  const pick = rated.length > 0 ? rated.slice(0, MAX_PINS) : sprints.slice(0, DEFAULT_UNRATED_PINS);
  return pick.map((s) => s.id);
}

/**
 * The pins to show: the stored ids whose sprint still exists (in stored
 * order, no repeats, at most five), or the default when nothing is stored.
 */
export function resolvePins(
  stored: readonly string[] | null,
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined
): string[] {
  if (stored === null) return defaultPins(sprints, series);
  const existing = new Set(sprints.map((s) => s.id));
  const out: string[] = [];
  for (const id of stored) {
    if (existing.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

export interface ComparePins {
  /** Pinned sprint ids, resolved against the sprints that exist. */
  pins: string[];
  /** True when nothing is stored and `pins` is the default list. */
  isDefault: boolean;
}

/** The pinned sprints, following storage (this tab and others). `sprints` newest first. */
export function useComparePins(
  sprints: readonly Sprint[],
  series: readonly SprintSeries[] | undefined
): ComparePins {
  // Read on every render as well as on change: the migration writes the key
  // directly, and finishing it re-renders the tool.
  const raw = useSyncExternalStore(subscribe, readPinsRaw, () => null);
  const stored = useMemo(() => parsePins(raw), [raw]);
  const pins = useMemo(() => resolvePins(stored, sprints, series), [stored, sprints, series]);
  return { pins, isDefault: stored === null };
}
