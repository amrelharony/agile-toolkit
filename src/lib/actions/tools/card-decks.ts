/**
 * Card Decks — tool-local actions.
 *
 * Category: Workshops & Facilitation (Phase 1 tools plan, P1.8)
 * Agent surface: tool.card_decks.*
 * Backing store: the tool store `agile-toolkit:card-decks` (lib/card-decks/store),
 *                synced as a user_state blob.
 *
 *   1. list_decks — every deck (built-in, Ice Breaker check-in/out, the
 *                   team's own) with its counts; one deck's cards and marks.
 *   2. list_state — the deck on the table, the cards dealt last, the round.
 *   3. deal       — deal one card or a hand onto the table, from what the
 *                   round can still deal (never a used or hidden card).
 *   4. shuffle    — start a new round: every dealt card goes back.
 *   5. add_card   — add a card to one of the team's own decks, or start one.
 *
 * Nothing here reaches a live room: dealing for the room is the host's own
 * button on the page, so every verb stays open to a visitor's Amr (it acts
 * on their own browser's decks only).
 *
 * In the browser the verbs read and write the tool store (rehydrated first,
 * so a write never replaces what was saved). Over MCP the tool's synced
 * copy is read; there is no server write for a tool store, so deal answers
 * without putting the cards on the table, and shuffle and add_card say so.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverGetUserStateBlob } from "../server-store";
import {
  CARD_DECK_LIMITS,
  CARD_DECKS_STORE_KEY,
  DEFAULT_DECK_ID,
  allDecks,
  cardKey,
  dealCards,
  dealtIds,
  findDeck,
  handOf,
  marksOf,
  normalizeCardDecks,
  roundProgress,
  validateCardDraft,
  validateDeckDraft,
  type CardDecksState,
  type CustomDeck,
  type Deck,
  type DeckCard,
} from "@/lib/card-decks/model";
import { ensureCardDecksHydrated, readCardDecks, updateCardDecks } from "@/lib/card-decks/store";

const TOOL = "tool.card_decks";

async function browserState(): Promise<CardDecksState> {
  await ensureCardDecksHydrated();
  return readCardDecks();
}

async function serverState(userId: string): Promise<CardDecksState> {
  return normalizeCardDecks(await serverGetUserStateBlob(userId, CARD_DECKS_STORE_KEY));
}

const NO_SERVER_WRITE =
  "Card Decks keeps its decks in the browser (synced as one tool store), and that can't be changed from here. Open /card-decks, or ask Amr there.";

const cardOut = (c: DeckCard) => ({
  id: c.id,
  text: c.text,
  ...(c.title ? { title: c.title } : {}),
  ...(c.hint ? { hint: c.hint } : {}),
});

const starredOnlyFor = (state: CardDecksState, deck: Deck) =>
  state.starredOnly && state.starred.some((k) => k.startsWith(`${deck.id}/`));

function deckSummary(state: CardDecksState, deck: Deck) {
  const marks = marksOf(state);
  const round = state.rounds[deck.id] ?? [];
  const p = roundProgress(deck, marks, round, starredOnlyFor(state, deck));
  return {
    id: deck.id,
    name: deck.name,
    source: deck.source,
    cards: p.total,
    inPlay: p.inPlay,
    starred: deck.cards.filter((c) => marks.starred.has(cardKey(deck.id, c.id))).length,
    dealtThisRound: p.dealt,
    leftThisRound: p.left,
  };
}

/* ── list_decks ─────────────────────────────────────────────────────── */

const listDecksParams = z.object({
  deckId: z
    .string()
    .max(64)
    .optional()
    .describe("A deck's id: also return its cards with their marks."),
});

function listDecks(state: CardDecksState, params: z.infer<typeof listDecksParams>) {
  const decks = allDecks(state.decks);
  const out = {
    current: state.deckId,
    decks: decks.map((d) => deckSummary(state, d)),
  };
  if (!params.deckId) return out;
  const deck = findDeck(state.decks, params.deckId);
  if (!deck) return { ...out, found: false, reason: `No deck "${params.deckId}".` };
  const marks = marksOf(state);
  const dealt = new Set(dealtIds(state.rounds[deck.id] ?? []));
  return {
    ...out,
    found: true,
    deck: {
      ...deckSummary(state, deck),
      blurb: deck.blurb,
      cardList: deck.cards.map((c) => {
        const key = cardKey(deck.id, c.id);
        return {
          ...cardOut(c),
          used: marks.used.has(key),
          starred: marks.starred.has(key),
          hidden: marks.hidden.has(key),
          dealtThisRound: dealt.has(c.id),
        };
      }),
    },
  };
}

registry.register({
  id: `${TOOL}.list_decks`,
  toolId: TOOL,
  name: "list_decks",
  category: "read",
  description:
    "List Card Decks' decks: the built-in ones (retro prompts, coaching questions, “Tell us about…” storytelling, story splitting with the SPIDR patterns, Yay! appreciation questions), the check-in and check-out decks read from the Ice Breaker, and the team's own. Params: {deckId?}. Returns {current (the deck on the table), decks: {id, name, source: built-in|icebreaker|custom, cards, inPlay (what a whole round deals: not used or hidden, and starred under starred-only; dealtThisRound + leftThisRound), starred, dealtThisRound, leftThisRound}[]}; with deckId also {found, deck: {…, blurb, cardList: {id, text, title?, hint?, used, starred, hidden, dealtThisRound}[]}}.",
  paramsSchema: listDecksParams,
  handler: async (params) => listDecks(await browserState(), params),
  mcpHandler: async (params, ctx) => listDecks(await serverState(ctx.userId), params),
});

/* ── list_state ─────────────────────────────────────────────────────── */

function listState(state: CardDecksState) {
  const deck = findDeck(state.decks, state.deckId) ?? findDeck([], DEFAULT_DECK_ID)!;
  const round = state.rounds[deck.id] ?? [];
  const starredOnly = starredOnlyFor(state, deck);
  const p = roundProgress(deck, marksOf(state), round, starredOnly);
  return {
    deck: { id: deck.id, name: deck.name, source: deck.source },
    hand: handOf(deck, round).map(cardOut),
    round: {
      dealt: p.dealt,
      left: p.left,
      inPlay: p.inPlay,
      total: p.total,
      setAside: p.setAside,
    },
    starredOnly,
    ownDecks: state.decks.length,
  };
}

registry.register({
  id: `${TOOL}.list_state`,
  toolId: TOOL,
  name: "list_state",
  category: "read",
  description:
    "What is on Card Decks' table: {deck: {id, name, source}, hand (the cards dealt last: {id, text, title?, hint?}[]), round: {dealt (cards in play dealt this round), left (still dealable this round), inPlay (dealt + left), total, setAside (used or hidden)}, starredOnly, ownDecks}.",
  paramsSchema: z.object({}),
  handler: async () => listState(await browserState()),
  mcpHandler: async (_p, ctx) => listState(await serverState(ctx.userId)),
});

/* ── deal ───────────────────────────────────────────────────────────── */

const dealParams = z.object({
  deckId: z
    .string()
    .max(64)
    .optional()
    .describe("The deck to deal from (it goes on the table). Default: the deck on the table."),
  count: z
    .number()
    .int()
    .min(1)
    .max(CARD_DECK_LIMITS.hand)
    .optional()
    .describe(`Cards to deal, 1 to ${CARD_DECK_LIMITS.hand}. Default 1.`),
});

type CardOut = ReturnType<typeof cardOut>;

type DealOut =
  | { dealt: false; reason: string }
  | {
      dealt: true;
      deck: { id: string; name: string };
      cards: CardOut[];
      /** Browser: what the round can still deal. */
      left?: number;
      /** MCP: the table didn't change. */
      saved?: false;
      note?: string;
    };

function dealFrom(
  state: CardDecksState,
  params: z.infer<typeof dealParams>
): { error: string } | { deck: Deck; result: ReturnType<typeof dealCards> } {
  const deck = findDeck(state.decks, params.deckId ?? state.deckId);
  if (!deck) return { error: `No deck "${params.deckId}". tool.card_decks.list_decks lists them.` };
  const round = state.rounds[deck.id] ?? [];
  const result = dealCards(
    deck,
    marksOf(state),
    round,
    params.count ?? 1,
    Math.random,
    starredOnlyFor(state, deck)
  );
  return { deck, result };
}

registry.register({
  id: `${TOOL}.deal`,
  toolId: TOOL,
  name: "deal",
  category: "write",
  requiresConfirmation: false,
  description: `Deal cards at random onto Card Decks' table, from what the round can still deal (a card is dealt once a round; used and hidden cards never are; with "starred only" on, starred cards only). Params: {deckId? (default the deck on the table; another deck goes on the table), count?: 1-${CARD_DECK_LIMITS.hand} (default 1)}. Returns {dealt: true, deck: {id, name}, cards: {id, text, title?, hint?}[], left} or {dealt: false, reason} (none left: shuffle first). It doesn't show the cards to a live room: the host does that on the page.`,
  paramsSchema: dealParams,
  handler: async (params): Promise<DealOut> => {
    const state = await browserState();
    const out = dealFrom(state, params);
    if ("error" in out) return { dealt: false, reason: out.error };
    const { deck, result } = out;
    if (result.cards.length === 0)
      return {
        dealt: false,
        reason:
          "No cards left to deal this round. Shuffle (tool.card_decks.shuffle) to start again.",
      };
    updateCardDecks((s) => ({ deckId: deck.id, rounds: { ...s.rounds, [deck.id]: result.round } }));
    const left = roundProgress(
      deck,
      marksOf(state),
      result.round,
      starredOnlyFor(state, deck)
    ).left;
    return {
      dealt: true,
      deck: { id: deck.id, name: deck.name },
      cards: result.cards.map(cardOut),
      left,
    };
  },
  mcpHandler: async (params, ctx): Promise<DealOut> => {
    const state = await serverState(ctx.userId);
    const out = dealFrom(state, params);
    if ("error" in out) return { dealt: false, reason: out.error };
    const { deck, result } = out;
    if (result.cards.length === 0)
      return { dealt: false, reason: "No cards left to deal this round on the saved table." };
    return {
      dealt: true,
      saved: false,
      note: "Drawn from the saved decks; the browser's table doesn't change from here.",
      deck: { id: deck.id, name: deck.name },
      cards: result.cards.map(cardOut),
    };
  },
});

/* ── shuffle ────────────────────────────────────────────────────────── */

type ShuffleOut =
  | { shuffled: false; reason: string }
  | { shuffled: true; deck: { id: string; name: string }; back: number };

const shuffleParams = z.object({
  deckId: z.string().max(64).optional().describe("Default: the deck on the table."),
});

registry.register({
  id: `${TOOL}.shuffle`,
  toolId: TOOL,
  name: "shuffle",
  category: "write",
  // Asks first (the write default): a shuffle forgets which cards the
  // meeting has had, and Amr's write has no Undo, unlike the page's Shuffle.
  description:
    "Start a new round of a Card Decks deck: every card dealt this round goes back (used and hidden cards stay set aside), and which cards were dealt is forgotten. Params: {deckId?}. Returns {shuffled: true, deck: {id, name}, back (cards returned)} or {shuffled: false, reason}.",
  paramsSchema: shuffleParams,
  handler: async (params): Promise<ShuffleOut> => {
    const state = await browserState();
    const deck = findDeck(state.decks, params.deckId ?? state.deckId);
    if (!deck) return { shuffled: false, reason: `No deck "${params.deckId}".` };
    const back = dealtIds(state.rounds[deck.id] ?? []).length;
    updateCardDecks((s) => {
      const rounds = { ...s.rounds };
      delete rounds[deck.id];
      return { rounds };
    });
    return { shuffled: true, deck: { id: deck.id, name: deck.name }, back };
  },
  mcpHandler: async (): Promise<ShuffleOut> => ({ shuffled: false, reason: NO_SERVER_WRITE }),
});

/* ── add_card ───────────────────────────────────────────────────────── */

const addCardParams = z.object({
  text: z
    .string()
    .min(1)
    .max(CARD_DECK_LIMITS.cardText)
    .describe(`The card: one question or prompt, up to ${CARD_DECK_LIMITS.cardText} characters.`),
  deckId: z
    .string()
    .max(64)
    .optional()
    .describe("One of the team's own decks. Default: the deck on the table, when it is their own."),
  newDeckName: z
    .string()
    .max(CARD_DECK_LIMITS.deckName)
    .optional()
    .describe("Start a new deck of the team's own with this name, holding the card."),
});

type AddCardResult =
  | {
      added: true;
      deckId: string;
      deckName: string;
      cardId: string;
      cards: number;
      newDeck: boolean;
    }
  | { added: false; reason: string };

function addCard(state: CardDecksState, params: z.infer<typeof addCardParams>): AddCardResult {
  if (params.newDeckName !== undefined) {
    // The store keeps CARD_DECK_LIMITS.decks decks: one more would be cut
    // when it is saved, and Amr would report a deck that doesn't exist.
    if (state.decks.length >= CARD_DECK_LIMITS.decks)
      return {
        added: false,
        reason: `The team has ${CARD_DECK_LIMITS.decks} decks of its own, the most Card Decks keeps. Delete one on /card-decks first, or add the card to a deck they have.`,
      };
    const card = validateCardDraft({ text: params.text }, null);
    if (!card.ok) return { added: false, reason: card.errors.text ?? "That card can't be added." };
    const check = validateDeckDraft(
      { name: params.newDeckName, cards: card.values.text },
      state.decks
    );
    if (!check.ok) return { added: false, reason: Object.values(check.errors).join(" ") };
    const at = new Date().toISOString();
    const deck: CustomDeck = {
      id: `deck_${nanoid(10)}`,
      name: check.values.name,
      cards: [{ id: `c_${nanoid(10)}`, text: check.values.cards[0] }],
      createdAt: at,
      updatedAt: at,
    };
    updateCardDecks((s) => ({ decks: [...s.decks, deck], deckId: deck.id }));
    return {
      added: true,
      deckId: deck.id,
      deckName: deck.name,
      cardId: deck.cards[0].id,
      cards: 1,
      newDeck: true,
    };
  }
  const id = params.deckId ?? state.deckId;
  const deck = state.decks.find((d) => d.id === id);
  if (!deck) {
    const builtIn = findDeck(state.decks, id);
    return {
      added: false,
      reason: builtIn
        ? `"${builtIn.name}" is a built-in deck and can't change. Give newDeckName to start a deck of the team's own.`
        : `No deck of the team's own with id "${id}". Give newDeckName to start one.`,
    };
  }
  const check = validateCardDraft({ text: params.text }, deck);
  if (!check.ok) return { added: false, reason: check.errors.text ?? "That card can't be added." };
  const card: DeckCard = { id: `c_${nanoid(10)}`, text: check.values.text };
  updateCardDecks((s) => ({
    decks: s.decks.map((d) =>
      d.id === deck.id
        ? { ...d, cards: [...d.cards, card], updatedAt: new Date().toISOString() }
        : d
    ),
  }));
  return {
    added: true,
    deckId: deck.id,
    deckName: deck.name,
    cardId: card.id,
    cards: deck.cards.length + 1,
    newDeck: false,
  };
}

registry.register({
  id: `${TOOL}.add_card`,
  toolId: TOOL,
  name: "add_card",
  category: "write",
  description: `Add a card to one of the team's own Card Decks decks (built-in decks don't change), or start a new deck with it. Params: {text (1-${CARD_DECK_LIMITS.cardText} characters), deckId? (default the deck on the table, when it is the team's own), newDeckName? (start a deck of that name; names must be new)}. A card already in the deck is refused. Returns {added: true, deckId, deckName, cardId, cards, newDeck} or {added: false, reason}.`,
  paramsSchema: addCardParams,
  handler: async (params) => addCard(await browserState(), params),
  mcpHandler: async (): Promise<AddCardResult> => ({ added: false, reason: NO_SERVER_WRITE }),
});
