/**
 * Relative Sizing's store (`agile-toolkit:relative-sizing`), shared by the
 * page and Amr's actions in the same tab, so a board Amr makes shows on the
 * page at once.
 *
 * It skips hydration at load like every tool store; the page and the
 * actions call `hydrateRelativeSizing()` before they read or write, so a
 * write never lands on the empty starting state and overwrites what was
 * saved. Writes go through `updateRelativeSizing`, which starts from the
 * clean data (./state.ts) and stores it clean.
 *
 * No "use client": the actions import it, and on the server the store is
 * an empty, unpersisted stand-in that the MCP handlers never use (they
 * patch the user's synced row with serverPatchUserStateBlob).
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import {
  RELATIVE_SIZING_INITIAL,
  RELATIVE_SIZING_STORE,
  normalizeRelativeSizingState,
  type RelativeSizingState,
} from "./state";

export { RELATIVE_SIZING_STORE_KEY } from "./state";

export const useRelativeSizing = createPersistedStore<RelativeSizingState>(
  RELATIVE_SIZING_STORE,
  RELATIVE_SIZING_INITIAL
);

/** Read back what this browser saved, once. */
export async function hydrateRelativeSizing(): Promise<void> {
  const persist = useRelativeSizing.persist;
  if (!persist || persist.hasHydrated()) return;
  try {
    await persist.rehydrate();
  } catch {
    /* storage blocked: the store works in memory */
  }
}

/** Whether this browser's saved data has been read back (writes wait for it). */
export function relativeSizingReady(): boolean {
  return useRelativeSizing.persist?.hasHydrated() ?? false;
}

/** The store's data, clean. */
export function relativeSizingState(): RelativeSizingState {
  return normalizeRelativeSizingState(useRelativeSizing.getState());
}

/**
 * Change the data, starting from the clean copy. Every write waits for
 * `hydrateRelativeSizing`: before it the store holds only the empty
 * starting state, and persisting that would overwrite what was saved.
 * Returns false when nothing was written.
 */
export function updateRelativeSizing(
  fn: (state: RelativeSizingState) => RelativeSizingState | null
): boolean {
  if (!relativeSizingReady()) return false;
  const next = fn(relativeSizingState());
  if (!next) return false;
  const clean = normalizeRelativeSizingState(next);
  useRelativeSizing.setState({
    boards: clean.boards,
    activeBoardId: clean.activeBoardId,
    rounds: clean.rounds,
  });
  return true;
}
