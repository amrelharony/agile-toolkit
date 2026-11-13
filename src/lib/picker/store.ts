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
 * In the browser it loads this browser's saved copy as soon as it is
 * created. The action registry creates it on every page where Amr's chat
 * opens, and cloud sync registers it a moment later (createPersistedStore):
 * left holding the defaults, a sync that merges the cloud row with what is
 * in memory would merge it with nothing and write that over the copy in
 * localStorage. Loading is synchronous (localStorage), so it is done before
 * sync can look. The page still renders the defaults until it has mounted,
 * so the server render and the first client render agree.
 *
 * Every write goes through `updatePicker`, which starts from the normalised
 * state, so nothing malformed that was synced or imported survives a write.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { PICKER_INITIAL, normalizePickerState, type PickerState } from "./model";

export const PICKER_STORE_NAME = "picker";
export const PICKER_STORE_KEY = `agile-toolkit:${PICKER_STORE_NAME}`;

export const usePickerStore = createPersistedStore<PickerState>(PICKER_STORE_NAME, PICKER_INITIAL);

if (typeof window !== "undefined") {
  try {
    void usePickerStore.persist.rehydrate();
  } catch {
    /* storage blocked: the store works from the defaults */
  }
}

/** The state as the page reads it. */
export function readPicker(): PickerState {
  return normalizePickerState(usePickerStore.getState());
}

/**
 * Change the state, starting from the clean copy; the result is cleaned
 * again. It also notes this browser's UTC offset, so the server can tell
 * which day is "today" for the user when Amr reads the Picker over MCP.
 */
export function updatePicker(fn: (state: PickerState) => PickerState): PickerState {
  // `0 - x` rather than `-x`, so UTC is 0, not -0.
  const utcOffset = typeof window === "undefined" ? null : 0 - new Date().getTimezoneOffset();
  const next = normalizePickerState({ ...fn(readPicker()), utcOffset });
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
