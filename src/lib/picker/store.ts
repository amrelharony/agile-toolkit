/**
 * Picker's saved state (`agile-toolkit:picker`, synced like other tool
 * stores): the saved lists and weights, the everyone-once progress, the role
 * rotation's history, recent picks and the name shortlist.
 *
 * Not a "use client" module, on purpose: the agent actions (lib/actions/
 * tools/picker.ts) read and write it in the browser, and an action module is
 * also loaded on the server, where a client module's exports are only
 * references. On the server the store is an empty, unused singleton; the
 * MCP handlers read the user's synced copy instead.
 *
 * It skips hydration at load; the page (and an action) rehydrates it first,
 * so the server render and the first client render agree. Every write goes
 * through `updatePicker`, which starts from the normalised state, so nothing
 * malformed that was synced or imported survives a write.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { PICKER_INITIAL, normalizePickerState, type PickerState } from "./model";

export const PICKER_STORE_NAME = "picker";
export const PICKER_STORE_KEY = `agile-toolkit:${PICKER_STORE_NAME}`;

export const usePickerStore = createPersistedStore<PickerState>(PICKER_STORE_NAME, PICKER_INITIAL);

/** The state as the page reads it. */
export function readPicker(): PickerState {
  return normalizePickerState(usePickerStore.getState());
}

/** Change the state, starting from the clean copy; the result is cleaned again. */
export function updatePicker(fn: (state: PickerState) => PickerState): PickerState {
  const next = normalizePickerState(fn(readPicker()));
  usePickerStore.setState(next);
  return next;
}

/** Read this browser's saved copy, once; later calls return straight away. */
export async function ensurePickerHydrated(): Promise<void> {
  const persist = usePickerStore.persist;
  if (!persist || persist.hasHydrated()) return;
  try {
    await persist.rehydrate();
  } catch {
    /* storage blocked: the page works from the defaults */
  }
}
