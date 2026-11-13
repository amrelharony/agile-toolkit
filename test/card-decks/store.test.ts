/**
 * Card Decks' tool store: it skips hydration at load, so the page and Amr's
 * actions read the saved state back first (`ensureCardDecksHydrated`); a
 * write after that keeps what was saved. Every update starts from, and
 * ends as, the cleaned state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_DECKS_INITIAL, CARD_DECKS_STORE_KEY, type CustomDeck } from "@/lib/card-decks/model";

const OWN: CustomDeck = {
  id: "deck_own",
  name: "Offsite",
  cards: [{ id: "c1", text: "One?" }],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const fresh = async () => {
  vi.resetModules();
  return import("@/lib/card-decks/store");
};

beforeEach(() => window.localStorage.clear());

describe("the Card Decks store", () => {
  it("reads the saved decks back before the first write, so the write keeps them", async () => {
    window.localStorage.setItem(
      CARD_DECKS_STORE_KEY,
      JSON.stringify({ state: { ...CARD_DECKS_INITIAL, decks: [OWN] }, version: 0 })
    );
    const store = await fresh();
    expect(store.useCardDecks.persist.hasHydrated()).toBe(false);
    await store.ensureCardDecksHydrated();
    expect(store.readCardDecks().decks.map((d) => d.id)).toEqual(["deck_own"]);
    store.updateCardDecks(() => ({ deckId: "deck_own" }));
    const saved = JSON.parse(window.localStorage.getItem(CARD_DECKS_STORE_KEY)!);
    expect(saved.state.deckId).toBe("deck_own");
    expect(saved.state.decks).toHaveLength(1);
    // A second call is a no-op.
    await store.ensureCardDecksHydrated();
  });

  it("cleans every update: a deck that doesn't exist can't go on the table", async () => {
    const store = await fresh();
    await store.ensureCardDecksHydrated();
    store.updateCardDecks(() => ({ deckId: "deck_missing", used: ["bad"] }));
    expect(store.readCardDecks()).toMatchObject({ deckId: "retro", used: [] });
  });
});
