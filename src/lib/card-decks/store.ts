/**
 * Card Decks' tool store (`agile-toolkit:card-decks`): the team's own decks,
 * the deck on the table, each deck's round, and the used, starred and hidden
 * marks. Synced like the other tool stores; every read goes through
 * `normalizeCardDecks`, because a synced or hand-edited value can hold
 * anything.
 *
 * No "use client": Amr's actions write here in the browser (the page, open
 * or not, picks the change up). On the server the store is an empty
 * singleton, so the actions' MCP handlers read the synced copy instead.
 * The store skips hydration at load; the page rehydrates it on mount, and
 * the actions do before they read or write, so a write never lands on an
 * empty store and replaces what was saved.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import {
  CARD_DECKS_INITIAL,
  CARD_DECKS_STORE,
  normalizeCardDecks,
  type CardDecksState,
} from "./model";

export const useCardDecks = createPersistedStore<CardDecksState>(
  CARD_DECKS_STORE,
  CARD_DECKS_INITIAL
);

/** The saved state, cleaned. */
export function readCardDecks(): CardDecksState {
  return normalizeCardDecks(useCardDecks.getState());
}

/** Change the state, starting from the clean copy; the result is cleaned again. */
export function updateCardDecks(fn: (state: CardDecksState) => Partial<CardDecksState>): void {
  useCardDecks.setState((s) => {
    const clean = normalizeCardDecks(s);
    return normalizeCardDecks({ ...clean, ...fn(clean) });
  });
}

let hydrating: Promise<void> | null = null;

/** Read the saved state back once (no-op once it has been). Never throws. */
export function ensureCardDecksHydrated(): Promise<void> {
  const persist = useCardDecks.persist;
  if (!persist || persist.hasHydrated()) return Promise.resolve();
  hydrating ??= Promise.resolve(persist.rehydrate())
    .catch(() => {
      /* storage blocked: the page works from memory */
    })
    .finally(() => {
      hydrating = null;
    });
  return hydrating;
}
