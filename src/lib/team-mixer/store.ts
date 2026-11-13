/**
 * Team Mixer's tool store (`agile-toolkit:team-mixer`), synced like the other
 * tool stores. Not a client module, so Amr's actions can read and write it
 * in the tab; the page reads it through `useTeamMixer` below.
 *
 * It skips hydration at load: the page (and an action) loads it first with
 * `loadMixer()`, so a write never lands on an empty store before the saved
 * copy has been read. Everything read goes through `normalizeMixerState`.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { MIXER_INITIAL, normalizeMixerState, type MixerState } from "./state";

export const TEAM_MIXER_STORE_KEY = "agile-toolkit:team-mixer";

export const useTeamMixerStore = createPersistedStore<MixerState>("team-mixer", MIXER_INITIAL);

let loading: Promise<void> | null = null;

/** Read the saved copy once (a second call waits for the first). */
export function loadMixer(): Promise<void> {
  const persist = useTeamMixerStore.persist;
  if (persist.hasHydrated()) return Promise.resolve();
  loading ??= Promise.resolve(persist.rehydrate())
    .catch(() => {
      /* storage blocked: the store works in memory */
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The state now, checked. */
export function readMixer(): MixerState {
  return normalizeMixerState(useTeamMixerStore.getState());
}

/** Replace the state with `next` (checked first). */
export function writeMixer(next: MixerState): void {
  useTeamMixerStore.setState(normalizeMixerState(next));
}

/** Change the state from its checked copy. */
export function updateMixer(fn: (s: MixerState) => MixerState): void {
  writeMixer(fn(readMixer()));
}
