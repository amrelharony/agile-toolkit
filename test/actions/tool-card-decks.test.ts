/**
 * tool.card_decks.* coverage (Phase 1 tools plan, P1.8).
 *
 *   1. registration — two reads, three writes; deal and shuffle need no
 *      confirmation; none is closed to a visitor (nothing reaches a room).
 *   2. list_decks / list_state — the built-in, Ice Breaker and own decks,
 *      one deck's cards with their marks, the table.
 *   3. deal / shuffle — from what the round can still deal, onto the table.
 *   4. add_card — into the team's own deck or a new one; built-in decks
 *      refused, repeats refused.
 *   5. the MCP path — reads the synced copy; never writes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const blobs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
  };
});

import { registry } from "@/lib/actions/registry";
import { CARD_DECKS_INITIAL, CARD_DECKS_STORE_KEY, type CustomDeck } from "@/lib/card-decks/model";
import { readCardDecks, useCardDecks } from "@/lib/card-decks/store";
import "@/lib/actions/tools/card-decks";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T>(
  path: "handler" | "mcpHandler",
  verb: string,
  params: Record<string, unknown> = {}
) => {
  const action = registry.get(`tool.card_decks.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};
const call = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("handler", verb, params);
const callMcp = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("mcpHandler", verb, params);

const OWN: CustomDeck = {
  id: "deck_own",
  name: "Offsite",
  cards: [
    { id: "c1", text: "One?" },
    { id: "c2", text: "Two?" },
  ],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

beforeEach(() => {
  blobs.clear();
  window.localStorage.clear();
  useCardDecks.setState({ ...CARD_DECKS_INITIAL });
});

describe("registration", () => {
  it("registers list_decks, list_state, deal, shuffle and add_card, each with an MCP handler", () => {
    const verbs = registry
      .list({ toolId: "tool.card_decks" })
      .map((a) => [
        a.name,
        a.category,
        a.requiresConfirmation ?? null,
        a.visitor ?? true,
        !!a.mcpHandler,
      ]);
    expect(verbs.sort()).toEqual(
      [
        ["add_card", "write", null, true, true],
        ["deal", "write", false, true, true],
        ["list_decks", "read", null, true, true],
        ["list_state", "read", null, true, true],
        ["shuffle", "write", false, true, true],
      ].sort()
    );
  });
});

describe("list_decks and list_state", () => {
  it("lists the seven built-in decks and the team's own, with counts", async () => {
    useCardDecks.setState({ decks: [OWN], used: ["retro/retro-01"], hidden: ["retro/retro-02"] });
    const out = await call<{
      current: string;
      decks: { id: string; source: string; cards: number; inPlay: number }[];
    }>("list_decks");
    expect(out.current).toBe("retro");
    expect(out.decks.map((d) => d.id)).toEqual([
      "retro",
      "coaching",
      "stories",
      "splitting",
      "yay",
      "check-in",
      "check-out",
      "deck_own",
    ]);
    const retro = out.decks[0];
    expect(retro.inPlay).toBe(retro.cards - 2);
    expect(out.decks.find((d) => d.id === "check-in")?.source).toBe("icebreaker");
    expect(out.decks.at(-1)).toMatchObject({ source: "custom", cards: 2 });
  });

  it("gives one deck's cards with their marks, and says when a deck is unknown", async () => {
    useCardDecks.setState({
      decks: [OWN],
      starred: ["deck_own/c2"],
      rounds: { deck_own: [["c1"]] },
    });
    const out = await call<{ found: boolean; deck: { cardList: unknown[] } }>("list_decks", {
      deckId: "deck_own",
    });
    expect(out.found).toBe(true);
    expect(out.deck.cardList).toEqual([
      { id: "c1", text: "One?", used: false, starred: false, hidden: false, dealtThisRound: true },
      { id: "c2", text: "Two?", used: false, starred: true, hidden: false, dealtThisRound: false },
    ]);
    expect(await call("list_decks", { deckId: "nope" })).toMatchObject({ found: false });
  });

  it("says what is on the table", async () => {
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own", rounds: { deck_own: [["c2"]] } });
    expect(await call("list_state")).toEqual({
      deck: { id: "deck_own", name: "Offsite", source: "custom" },
      hand: [{ id: "c2", text: "Two?" }],
      round: { dealt: 1, left: 1, inPlay: 2, total: 2, setAside: 0 },
      starredOnly: false,
      ownDecks: 1,
    });
  });
});

describe("deal and shuffle", () => {
  it("deals onto the table from the deck asked for, which goes on the table", async () => {
    useCardDecks.setState({ decks: [OWN] });
    const out = await call<{ dealt: boolean; cards: { id: string }[]; left: number }>("deal", {
      deckId: "deck_own",
      count: 2,
    });
    expect(out.dealt).toBe(true);
    expect(out.cards.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(out.left).toBe(0);
    const state = readCardDecks();
    expect(state.deckId).toBe("deck_own");
    expect(state.rounds.deck_own).toHaveLength(1);
    expect(await call("deal", { deckId: "deck_own" })).toMatchObject({ dealt: false });
  });

  it("never deals a used or hidden card", async () => {
    useCardDecks.setState({ decks: [OWN], used: ["deck_own/c1"] });
    const out = await call<{ cards: { id: string }[] }>("deal", { deckId: "deck_own", count: 2 });
    expect(out.cards.map((c) => c.id)).toEqual(["c2"]);
    expect(await call("deal", { deckId: "nope" })).toMatchObject({ dealt: false });
  });

  it("shuffles: every dealt card goes back", async () => {
    useCardDecks.setState({
      decks: [OWN],
      deckId: "deck_own",
      rounds: { deck_own: [["c1"], ["c2"]] },
    });
    expect(await call("shuffle")).toEqual({
      shuffled: true,
      deck: { id: "deck_own", name: "Offsite" },
      back: 2,
    });
    expect(readCardDecks().rounds.deck_own).toBeUndefined();
  });
});

describe("add_card", () => {
  it("adds to the team's own deck on the table, and refuses a repeat", async () => {
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own" });
    const out = await call<{ added: boolean; cards: number }>("add_card", { text: "  Three?  " });
    expect(out).toMatchObject({ added: true, deckId: "deck_own", cards: 3, newDeck: false });
    expect(readCardDecks().decks[0].cards.map((c) => c.text)).toEqual(["One?", "Two?", "Three?"]);
    expect(await call("add_card", { text: "three?" })).toEqual({
      added: false,
      reason: "That card is in the deck already.",
    });
  });

  it("refuses a built-in deck, and starts a new deck with newDeckName", async () => {
    const refused = await call<{ added: boolean; reason: string }>("add_card", { text: "Hi?" });
    expect(refused.added).toBe(false);
    expect(refused.reason).toContain("built-in deck");
    const made = await call<{ added: boolean; deckId: string; newDeck: boolean }>("add_card", {
      text: "Hi?",
      newDeckName: "Mine",
    });
    expect(made).toMatchObject({ added: true, newDeck: true, deckName: "Mine", cards: 1 });
    const state = readCardDecks();
    expect(state.deckId).toBe(made.deckId);
    expect(state.decks[0].cards[0].text).toBe("Hi?");
    expect(await call("add_card", { text: "Again?", newDeckName: "mine" })).toMatchObject({
      added: false,
    });
    expect(await call("add_card", { text: "Hi?", newDeckName: "Retro prompts" })).toMatchObject({
      added: false,
    });
  });
});

describe("the MCP path", () => {
  it("reads the synced copy of the decks", async () => {
    blobs.set(CARD_DECKS_STORE_KEY, { ...CARD_DECKS_INITIAL, decks: [OWN], deckId: "deck_own" });
    const out = await callMcp<{ current: string; decks: { id: string }[] }>("list_decks");
    expect(out.current).toBe("deck_own");
    expect(out.decks.map((d) => d.id)).toContain("deck_own");
    expect(await callMcp("list_state")).toMatchObject({ deck: { id: "deck_own" }, hand: [] });
  });

  it("deals without saving, and refuses shuffle and add_card", async () => {
    blobs.set(CARD_DECKS_STORE_KEY, { ...CARD_DECKS_INITIAL, decks: [OWN] });
    const out = await callMcp<{ dealt: boolean; saved: boolean; cards: unknown[] }>("deal", {
      deckId: "deck_own",
    });
    expect(out).toMatchObject({ dealt: true, saved: false });
    expect(out.cards).toHaveLength(1);
    expect(await callMcp("shuffle")).toMatchObject({ shuffled: false });
    expect(await callMcp("add_card", { text: "Hi?", newDeckName: "Mine" })).toMatchObject({
      added: false,
    });
    expect(readCardDecks().decks).toEqual([]);
  });

  it("reads an empty account as the built-in decks only", async () => {
    const out = await callMcp<{ decks: unknown[] }>("list_decks");
    expect(out.decks).toHaveLength(7);
  });
});
