import { describe, expect, it } from "vitest";
import { hideCards, hiddenTotal } from "@/app/(tools)/retro/room/hidden";
import type { RetroCard } from "@/app/(tools)/retro/types";

/**
 * What a host's own screen shows while a live room hides the participants'
 * cards: its own cards, and a count per column for the rest.
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

describe("hideCards", () => {
  it("shows everything when nothing is hidden", () => {
    const cards = [card("a"), card("b")];
    const view = hideCards(cards, null);
    expect(view.shown).toEqual(cards);
    expect(view.hiddenCounts).toBeNull();
    expect(hiddenTotal(view.hiddenCounts)).toBe(0);
  });

  it("leaves the hidden cards out and counts them per column", () => {
    const cards = [
      card("mine"),
      card("p1"),
      card("p2", { columnKey: "stop" }),
      card("p3", { columnKey: "stop" }),
    ];
    const view = hideCards(cards, new Set(["p1", "p2", "p3"]));
    expect(view.shown.map((c) => c.id)).toEqual(["mine"]);
    expect(view.hiddenCounts).toEqual({ start: 1, stop: 2 });
    expect(hiddenTotal(view.hiddenCounts)).toBe(3);
  });

  it("stands a shown card on its own when its group's top card is hidden", () => {
    const view = hideCards([card("p1"), card("mine", { groupedWith: "p1" })], new Set(["p1"]));
    expect(view.shown).toEqual([card("mine", { groupedWith: null })]);
  });

  it("hides nothing, but says so, with an empty set", () => {
    const view = hideCards([card("a")], new Set());
    expect(view.shown.map((c) => c.id)).toEqual(["a"]);
    expect(view.hiddenCounts).toEqual({});
  });
});
