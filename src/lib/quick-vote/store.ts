/**
 * Quick Vote's store (`agile-toolkit:quick-vote`), shared by the page and
 * Amr's actions in the same tab, so a round Amr sets up shows on the page
 * at once.
 *
 * It skips hydration at load like every tool store; the page and the
 * actions call `hydrateQuickVote()` before they read or write, so a write
 * never lands on the empty starting state and overwrites what was saved.
 * Writes go through the helpers below, which start from the clean data
 * (lib/quick-vote/state.ts) and store it clean.
 *
 * No "use client": the actions import it, and on the server the store is
 * an empty, unpersisted stand-in that the actions' MCP handlers never use.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import type { RoundDraft } from "./draft";
import type { SavedResult } from "./results";
import {
  MAX_CUSTOM_PRESETS,
  QUICK_VOTE_INITIAL,
  normalizeCustomPresets,
  normalizeQuickVoteState,
  type CustomPreset,
  type QuickVoteState,
} from "./state";
import { normalizeDraft } from "./draft";
import { MAX_RESULTS, normalizeResults } from "./results";

export const QUICK_VOTE_STORE = "quick-vote";
/** Where the store lives: the browser's key, and the synced row's store_key. */
export const QUICK_VOTE_STORE_KEY = `agile-toolkit:${QUICK_VOTE_STORE}`;

export const useQuickVote = createPersistedStore<QuickVoteState>(
  QUICK_VOTE_STORE,
  QUICK_VOTE_INITIAL
);

/** Read back what this browser saved, once. */
export async function hydrateQuickVote(): Promise<void> {
  const persist = useQuickVote.persist;
  if (!persist || persist.hasHydrated()) return;
  try {
    await persist.rehydrate();
  } catch {
    /* storage blocked: the store works in memory */
  }
}

/** Whether this browser's saved data has been read back (writes wait for it). */
export function quickVoteReady(): boolean {
  return useQuickVote.persist?.hasHydrated() ?? false;
}

/** The store's data, clean. */
export function quickVoteState(): QuickVoteState {
  return normalizeQuickVoteState(useQuickVote.getState());
}

/**
 * Change the saved results, starting from the clean list. Every write
 * waits for `hydrateQuickVote`: before it, the store holds only the empty
 * starting state, and persisting that would overwrite what was saved.
 */
export function updateResults(fn: (list: readonly SavedResult[]) => SavedResult[]): void {
  if (!quickVoteReady()) return;
  useQuickVote.setState((s) => ({
    results: normalizeResults(fn(normalizeResults(s.results))).slice(0, MAX_RESULTS),
  }));
}

/** Change the saved formats, starting from the clean list. */
export function updateCustomPresets(fn: (list: readonly CustomPreset[]) => CustomPreset[]): void {
  if (!quickVoteReady()) return;
  useQuickVote.setState((s) => ({
    customPresets: normalizeCustomPresets(fn(normalizeCustomPresets(s.customPresets))).slice(
      0,
      MAX_CUSTOM_PRESETS
    ),
  }));
}

/** Set the round being set up (null: none). */
export function setDraft(draft: RoundDraft | null): void {
  if (!quickVoteReady()) return;
  useQuickVote.setState({ draft: draft ? normalizeDraft(draft) : null });
}
