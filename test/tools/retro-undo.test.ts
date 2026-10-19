import { describe, it, expect } from "vitest";
import { removeCardWithGroup, restoreRemovedCards } from "@/app/(tools)/retro/helpers";
import type { RetroCard } from "@/app/(tools)/retro/types";

/**
 * Retro card delete + Undo: a card goes with the cards grouped under it,
 * and Undo puts them all back in place, still grouped, without losing what
 * changed on the board in the meantime.
 */

function card(id: string, overrides: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey: "start",
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...overrides,
  };
}

const ids = (cards: RetroCard[]) => cards.map((c) => c.id);

describe("removeCardWithGroup", () => {
  it("removes the card and the cards grouped under it", () => {
    const cards = [card("a"), card("b", { groupedWith: "a" }), card("c")];
    const { cards: next, removed } = removeCardWithGroup(cards, "a");
    expect(ids(next)).toEqual(["c"]);
    expect(Array.from(removed).sort()).toEqual(["a", "b"]);
  });

  it("unhooks a survivor that pointed at a removed card", () => {
    const cards = [card("a", { groupedWith: "b" }), card("b"), card("c", { groupedWith: "a" })];
    const { cards: next } = removeCardWithGroup(cards, "b");
    // a was grouped under b, so it goes; c pointed at a and is unhooked.
    expect(next).toEqual([card("c")]);
  });
});

describe("restoreRemovedCards", () => {
  it("puts a group back at its old positions, still grouped", () => {
    const before = [card("a"), card("b"), card("c", { groupedWith: "b" }), card("d")];
    const { cards: after, removed } = removeCardWithGroup(before, "b");
    expect(restoreRemovedCards(after, before, removed)).toEqual(before);
  });

  it("re-hooks a survivor that the delete unhooked", () => {
    const before = [card("a", { groupedWith: "b" }), card("b"), card("c", { groupedWith: "a" })];
    const { cards: after, removed } = removeCardWithGroup(before, "b");
    expect(restoreRemovedCards(after, before, removed)).toEqual(before);
  });

  it("keeps edits, additions and deletions made since", () => {
    const before = [card("a"), card("b"), card("c")];
    const { cards: after, removed } = removeCardWithGroup(before, "b");
    const since = [card("a", { text: "Edited" }), card("e")]; // c deleted, e added
    expect(restoreRemovedCards(since, before, removed)).toEqual([
      card("a", { text: "Edited" }),
      card("b"),
      card("e"),
    ]);
    expect(after).toHaveLength(2);
  });

  it("does not duplicate a card that is already back", () => {
    const before = [card("a"), card("b")];
    const { removed } = removeCardWithGroup(before, "b");
    expect(ids(restoreRemovedCards(before, before, removed))).toEqual(["a", "b"]);
  });
});
