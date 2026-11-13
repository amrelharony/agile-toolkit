// @vitest-environment node
/**
 * Card Decks' content and model: the built-in decks (our own words, at least
 * 24 cards each, card text within 140 characters, ids fixed and unique), the
 * check-in and check-out decks read from the Ice Breaker (its own text, not
 * a copy), story splitting from Refinement's SPLIT_PATTERNS; then the
 * table's rules (a card dealt once a round, used and hidden never, starred
 * only), going back, the saved state read back, and the deck form's checks.
 */

import { describe, expect, it } from "vitest";
import { icebreakers } from "@/lib/constants/icebreakers";
import { SPLIT_PATTERNS } from "@/app/(tools)/refinement/invest";
import { BUILT_IN_DECKS, builtInDeck, isBuiltInDeckId } from "@/lib/card-decks/decks";
import {
  CARD_DECK_LIMITS,
  CARD_DECKS_INITIAL,
  activeCards,
  backOne,
  cardKey,
  cardLines,
  cleanLine,
  dealCards,
  dealChosen,
  dealableCards,
  findDeck,
  handOf,
  marksOf,
  mergeCards,
  nearestBuiltInDeck,
  normalizeCardDecks,
  normalizeRound,
  roundProgress,
  toggleMark,
  validateCardDraft,
  validateDeckDraft,
  type CustomDeck,
} from "@/lib/card-decks/model";
import { CONTROL_OR_BIDI_RE, hasControlOrBidi } from "@/lib/realtime/sanitize";
import { createRng } from "@/lib/utils/random";

const deck = (id: string) => builtInDeck(id)!;
const noMarks = marksOf({ used: [], starred: [], hidden: [] });
const own = (over: Partial<CustomDeck> = {}): CustomDeck => ({
  id: "deck_a",
  name: "Offsite",
  cards: [
    { id: "c1", text: "One" },
    { id: "c2", text: "Two" },
    { id: "c3", text: "Three" },
  ],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...over,
});

describe("the built-in decks", () => {
  it("are the five written decks plus check-in and check-out", () => {
    expect(BUILT_IN_DECKS.map((d) => d.id)).toEqual([
      "retro",
      "coaching",
      "stories",
      "splitting",
      "yay",
      "check-in",
      "check-out",
    ]);
  });

  it("hold at least 24 cards each where written here, every card within 140 characters", () => {
    for (const d of BUILT_IN_DECKS.filter((x) => x.source === "built-in")) {
      expect(d.cards.length, d.id).toBeGreaterThanOrEqual(24);
    }
    for (const d of BUILT_IN_DECKS) {
      for (const c of d.cards) {
        expect(c.text.length, c.id).toBeLessThanOrEqual(CARD_DECK_LIMITS.cardText);
        expect(cleanLine(c.text, CARD_DECK_LIMITS.cardText), c.id).toBe(c.text);
      }
    }
  });

  it("give every card a unique id with no space or slash, and no text twice in a deck", () => {
    for (const d of BUILT_IN_DECKS) {
      const ids = d.cards.map((c) => c.id);
      expect(new Set(ids).size, d.id).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[^\s/]+$/);
      const texts = d.cards.map((c) => c.text.toLowerCase());
      expect(new Set(texts).size, d.id).toBe(texts.length);
    }
  });

  it("read check-in and check-out from the Ice Breaker's own activities", () => {
    const byId = new Map(icebreakers.map((ib) => [ib.id, ib]));
    for (const id of ["check-in", "check-out"]) {
      const d = deck(id);
      expect(d.source).toBe("icebreaker");
      expect(d.cards.length).toBeGreaterThanOrEqual(8);
      for (const c of d.cards) {
        const ib = byId.get(c.id.replace(/^ib-/, ""))!;
        expect(ib, c.id).toBeDefined();
        // The same string: read, never a copy kept here.
        expect(c.text).toBe(ib.description);
        if (id === "check-in" || !/check[\s-]?in\b/i.test(ib.name)) expect(c.title).toBe(ib.name);
      }
    }
    expect(deck("check-in").cards.map((c) => c.id)).toContain("ib-q-7");
    expect(deck("check-out").cards.map((c) => c.id)).toContain("ib-a-7");
  });

  it("never puts a Check-In name on a check-out card", () => {
    const out = deck("check-out").cards;
    const oneWord = out.find((c) => c.id === "ib-q-7");
    expect(oneWord).toBeDefined();
    expect(oneWord?.title).toBeUndefined();
    for (const c of out) expect(c.title ?? "", c.id).not.toMatch(/check[\s-]?in/i);
    expect(deck("check-in").cards.find((c) => c.id === "ib-q-7")?.title).toBe("One Word Check-In");
  });

  it("split stories by every SPLIT_PATTERNS pattern, five worked examples each, with its how", () => {
    const d = deck("splitting");
    for (const p of SPLIT_PATTERNS) {
      const cards = d.cards.filter((c) => c.title === p.name);
      expect(cards, p.id).toHaveLength(5);
      for (const c of cards) expect(c.hint).toBe(p.how);
    }
    expect(d.cards).toHaveLength(SPLIT_PATTERNS.length * 5);
  });

  it("know their own ids", () => {
    expect(isBuiltInDeckId("yay")).toBe(true);
    expect(isBuiltInDeckId("deck_x")).toBe(false);
    expect(isBuiltInDeckId(42)).toBe(false);
  });
});

describe("dealing", () => {
  const retro = deck("retro");

  it("deals one card at random, never one dealt already this round", () => {
    const rng = createRng(7);
    let round: string[][] = [];
    const seen = new Set<string>();
    for (let i = 0; i < retro.cards.length; i++) {
      const r = dealCards(retro, noMarks, round, 1, rng);
      expect(r.cards).toHaveLength(1);
      expect(seen.has(r.cards[0].id)).toBe(false);
      seen.add(r.cards[0].id);
      round = r.round;
    }
    expect(seen.size).toBe(retro.cards.length);
    const done = dealCards(retro, noMarks, round, 1, rng);
    expect(done.cards).toEqual([]);
    expect(done.round).toEqual(round);
  });

  it("deals a hand of several, capped at seven, and fewer when fewer are left", () => {
    const hand = dealCards(retro, noMarks, [], 3, createRng(1));
    expect(hand.cards).toHaveLength(3);
    expect(hand.round).toEqual([hand.cards.map((c) => c.id)]);
    expect(dealCards(retro, noMarks, [], 50, createRng(1)).cards).toHaveLength(7);
    const small = findDeck([own()], "deck_a")!;
    const two = dealCards(small, noMarks, [["c1"]], 5, createRng(1));
    expect(two.cards.map((c) => c.id).sort()).toEqual(["c2", "c3"]);
  });

  it("skips used and hidden cards, and deals only starred ones when asked", () => {
    const small = findDeck([own()], "deck_a")!;
    const marks = marksOf({
      used: [cardKey("deck_a", "c1")],
      hidden: [cardKey("deck_a", "c2")],
      starred: [cardKey("deck_a", "c3")],
    });
    expect(dealableCards(small, marks, []).map((c) => c.id)).toEqual(["c3"]);
    expect(activeCards(small, marks)).toHaveLength(1);
    const starredOnly = marksOf({ used: [], hidden: [], starred: [cardKey("deck_a", "c2")] });
    expect(dealableCards(small, starredOnly, [], true).map((c) => c.id)).toEqual(["c2"]);
    expect(roundProgress(small, marks, [])).toEqual({
      dealt: 0,
      left: 1,
      inPlay: 1,
      total: 3,
      setAside: 2,
    });
  });

  it("counts a dealt card out of the round once it is marked used, so the counts add up", () => {
    const small = findDeck([own()], "deck_a")!;
    const round = [["c1"]];
    expect(roundProgress(small, noMarks, round)).toEqual({
      dealt: 1,
      left: 2,
      inPlay: 3,
      total: 3,
      setAside: 0,
    });
    const used = marksOf({ used: [cardKey("deck_a", "c1")], starred: [], hidden: [] });
    const p = roundProgress(small, used, round);
    expect(p).toEqual({ dealt: 0, left: 2, inPlay: 2, total: 3, setAside: 1 });
    expect(p.dealt + p.left).toBe(p.inPlay);
    expect(p.inPlay + p.setAside).toBe(p.total);
  });

  it("counts the starred cards only under starred-only", () => {
    const small = findDeck([own()], "deck_a")!;
    const starred = marksOf({ used: [], hidden: [], starred: [cardKey("deck_a", "c2")] });
    expect(roundProgress(small, starred, [["c2"]], true)).toMatchObject({
      dealt: 1,
      left: 0,
      inPlay: 1,
    });
    // A card dealt before starred-only went on isn't one of the starred ones.
    expect(roundProgress(small, starred, [["c1"]], true)).toMatchObject({
      dealt: 0,
      left: 1,
      inPlay: 1,
    });
  });

  it("deals the one card Amr picked, only while the round can deal it", () => {
    const small = findDeck([own()], "deck_a")!;
    expect(dealChosen(small, noMarks, [], "c2")).toEqual({
      cards: [{ id: "c2", text: "Two" }],
      round: [["c2"]],
    });
    expect(dealChosen(small, noMarks, [["c2"]], "c2")).toBeNull();
    expect(dealChosen(small, noMarks, [], "nope")).toBeNull();
  });

  it("goes back one deal, and the hand is the last deal", () => {
    const small = findDeck([own()], "deck_a")!;
    const round = [["c1"], ["c2", "c3"]];
    expect(handOf(small, round).map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(backOne(round)).toEqual([["c1"]]);
    expect(handOf(small, backOne(backOne(round)))).toEqual([]);
  });

  it("toggles a mark and keeps each key once", () => {
    expect(toggleMark([], "a/b")).toEqual(["a/b"]);
    expect(toggleMark(["a/b"], "a/b")).toEqual([]);
  });
});

describe("the saved state, read back", () => {
  it("starts on the retro prompts with nothing saved", () => {
    expect(normalizeCardDecks(undefined)).toEqual(CARD_DECKS_INITIAL);
    expect(CARD_DECKS_INITIAL.deckId).toBe("retro");
  });

  it("keeps valid decks, cards and marks, and drops what a sync or a hand edit broke", () => {
    const state = normalizeCardDecks({
      decks: [
        own({ cards: [...own().cards, { id: "c1", text: "dupe" }, { id: "bad id", text: "x" }] }),
        { id: "retro", name: "Steals a built-in id", cards: [] },
        { id: "deck_b", name: "   " },
        own(),
      ],
      deckId: "deck_gone",
      rounds: { deck_a: [["c1", "zz"], [], ["c1"], ["c2"]], retro: [["retro-01"]], nope: [["x"]] },
      used: ["deck_a/c1", "deck_a/c1", "bad", 4],
      starred: "not a list",
      hidden: ["retro/retro-02"],
      starredOnly: "yes",
    });
    expect(state.decks).toHaveLength(1);
    expect(state.decks[0].cards.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(state.deckId).toBe("retro");
    expect(state.rounds).toEqual({ deck_a: [["c1"], ["c2"]], retro: [["retro-01"]] });
    expect(state.used).toEqual(["deck_a/c1"]);
    expect(state.starred).toEqual([]);
    expect(state.hidden).toEqual(["retro/retro-02"]);
    expect(state.starredOnly).toBe(false);
  });

  it("caps a round's deals and a deal's cards", () => {
    const retro = deck("retro");
    const long = normalizeRound([retro.cards.slice(0, 9).map((c) => c.id)], retro);
    expect(long[0]).toHaveLength(CARD_DECK_LIMITS.hand);
  });

  it("cleans text: hidden characters out, spaces collapsed, cut without splitting a pair", () => {
    expect(cleanLine("  Hello​\n  world‮ ", 140)).toBe("Hello world");
    expect(cleanLine("ab😀", 3)).toBe("ab");
    expect(cleanLine(5, 10)).toBe("");
  });

  it("takes out every character the live room refuses, and the zero-width ones", () => {
    // model.ts keeps its own copy of the room's list (an action module may
    // not import realtime code): this holds the two together.
    for (let code = 0; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const ch = String.fromCharCode(code);
      if (!CONTROL_OR_BIDI_RE.test(ch)) continue;
      expect(hasControlOrBidi(cleanLine(`a${ch}b`, 140)), `U+${code.toString(16)}`).toBe(false);
    }
    for (const ch of ["​", "‌", "‍", "﻿"]) {
      expect(cleanLine(`a${ch}b`, 140)).toBe("a b");
    }
  });
});

describe("the deck form", () => {
  it("reads one card per line, dropping bullets, blanks and repeats", () => {
    expect(cardLines("- One\n\n2. Two\n* one\n  Three  ")).toEqual(["One", "Two", "Three"]);
  });

  it("needs a new name and 1 to 80 cards of up to 140 characters", () => {
    expect(validateDeckDraft({ name: "", cards: "" })).toEqual({
      ok: false,
      errors: {
        name: "Give the deck a name.",
        cards: "Write at least one card, one per line.",
      },
    });
    expect(validateDeckDraft({ name: "Retro prompts", cards: "a" }).ok).toBe(false);
    expect(validateDeckDraft({ name: "Offsite", cards: "a" }, [own()]).ok).toBe(false);
    expect(validateDeckDraft({ name: "Offsite", cards: "a" }, [own()], "deck_a").ok).toBe(true);
    const long = validateDeckDraft({ name: "Mine", cards: `ok\n${"x".repeat(141)}` });
    expect(long).toEqual({
      ok: false,
      errors: { cards: "Card 2 is longer than 140 characters. Shorten it." },
    });
    const many = Array.from({ length: 81 }, (_, i) => `Card ${i}`).join("\n");
    expect(validateDeckDraft({ name: "Mine", cards: many }).ok).toBe(false);
    expect(validateDeckDraft({ name: " Mine ", cards: "One\nTwo" })).toEqual({
      ok: true,
      values: { name: "Mine", cards: ["One", "Two"] },
    });
  });

  it("checks one new card: written, short enough, not in the deck already, the deck not full", () => {
    const d = findDeck([own()], "deck_a")!;
    expect(validateCardDraft({ text: "  " }, d).ok).toBe(false);
    expect(validateCardDraft({ text: "x".repeat(141) }, d).ok).toBe(false);
    expect(validateCardDraft({ text: "two" }, d)).toEqual({
      ok: false,
      errors: { text: "That card is in the deck already." },
    });
    const full = { cards: Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, text: `${i}` })) };
    expect(validateCardDraft({ text: "new" }, full).ok).toBe(false);
    expect(validateCardDraft({ text: " Four " }, d)).toEqual({
      ok: true,
      values: { text: "Four" },
    });
  });

  it("keeps a card's id through an edit when its text stays", () => {
    let n = 0;
    const next = mergeCards(own().cards, ["two", "Four"], () => `n${++n}`);
    expect(next).toEqual([
      { id: "c2", text: "two" },
      { id: "n1", text: "Four" },
    ]);
  });
});

describe("the nearest built-in deck", () => {
  it("matches a theme to a deck by its words", () => {
    expect(nearestBuiltInDeck("Retros that go deeper").id).toBe("retro");
    expect(nearestBuiltInDeck("Splitting big user stories").id).toBe("splitting");
    expect(nearestBuiltInDeck("Gratitude and thanks").id).toBe("yay");
    expect(nearestBuiltInDeck("Coaching a new Scrum Master").id).toBe("coaching");
    expect(nearestBuiltInDeck("Closing the workshop: check-out").id).toBe("check-out");
    expect(nearestBuiltInDeck("zzz").id).toBe("retro");
  });
});
