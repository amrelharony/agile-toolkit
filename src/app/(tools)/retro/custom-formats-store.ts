"use client";

/**
 * The custom retro formats this browser keeps (`agile-toolkit:retro-formats`,
 * synced like other tool stores when the owner is signed in). Each is the
 * draft the Custom form saved, a name and its column names, under its id;
 * the format itself is rebuilt from it (lib/retro/custom-format), so its
 * colours always come from the app's palette.
 *
 * Read through `normalizeSavedFormats`, because a synced or hand-edited
 * value can hold anything. Skips hydration at load: the format picker
 * rehydrates it on mount, so the server render and the first client render
 * agree.
 */

import { useMemo } from "react";
import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { normalizeSavedFormats, type SavedCustomFormat } from "@/lib/retro/custom-format";

export interface RetroFormatsSettings {
  /** Newest first. */
  custom: SavedCustomFormat[];
}

export const RETRO_FORMATS_INITIAL: RetroFormatsSettings = { custom: [] };

export const useRetroFormatsStore = createPersistedStore<RetroFormatsSettings>(
  "retro-formats",
  RETRO_FORMATS_INITIAL
);

/** Change the saved list, starting from the clean one. */
export function updateSavedFormats(
  fn: (list: readonly SavedCustomFormat[]) => SavedCustomFormat[]
): void {
  useRetroFormatsStore.setState((s) => ({
    custom: normalizeSavedFormats(fn(normalizeSavedFormats(s.custom))),
  }));
}

/** The saved custom formats, clean, newest first. */
export function useSavedFormats(): SavedCustomFormat[] {
  const raw = useRetroFormatsStore((s) => s.custom);
  return useMemo(() => normalizeSavedFormats(raw), [raw]);
}
