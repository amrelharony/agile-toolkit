"use client";

/**
 * The PI board's own persisted state (localStorage plus cloud sync under
 * `agile-toolkit:pi-planning`, unchanged so saved boards keep loading).
 *
 * The types, caps and `normalizePiState` live in `src/lib/pi-planning/model`
 * (pure, so Amr's verbs read the same blob on the server); this module
 * re-exports them beside the hook, so the page and Scrum of Scrums keep
 * importing from here. Every read goes through `normalizePiState`.
 */

import { useCallback, useMemo } from "react";
import { usePersisted } from "@/lib/utils/use-persisted";
import {
  DEFAULT_PI_STATE,
  PI_STORAGE_KEY,
  normalizePiState,
  type PiState,
} from "@/lib/pi-planning/model";

export {
  DEFAULT_PI_STATE,
  MAX_ITERATIONS,
  PI_ITEM_KINDS,
  PI_STORAGE_KEY,
  normalizePiState,
  piTeamNames,
} from "@/lib/pi-planning/model";
export type {
  PiBand,
  PiConfidenceVote,
  PiItem,
  PiItemKind,
  PiObjective,
  PiRecord,
  PiRecordTeam,
  PiState,
  PiTeam,
  RoamStatus,
} from "@/lib/pi-planning/model";

/** The board, normalized, and a setter that always starts from the latest saved value. */
export function usePiState(): [PiState, (fn: (s: PiState) => PiState) => void] {
  const [raw, setRaw] = usePersisted<unknown>(PI_STORAGE_KEY, DEFAULT_PI_STATE);
  const state = useMemo(() => normalizePiState(raw), [raw]);
  const update = useCallback(
    (fn: (s: PiState) => PiState) => setRaw((prev: unknown) => fn(normalizePiState(prev))),
    [setRaw]
  );
  return [state, update];
}
