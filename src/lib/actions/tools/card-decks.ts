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
 * Each write is a pure planner (`planDeal`, `planShuffle`, `planAddCard`):
 * it takes the clean state and returns the verb's answer and the next state,
 * or null when nothing changes. In the browser the verbs read the tool store
 * (rehydrated first, so a write never replaces what was saved) and apply the
 * next state there. Over MCP they read and write the synced copy with
 * `serverPatchUserStateBlob`: the planner runs on the saved blob, cleaned by
 * the store's own normaliser, and runs again if another write got there
 * first (the last run's answer is the one returned). An open page picks the
 * change up, unless that tab has a change of its own it hasn't saved yet,
 * which then wins.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverGetUserStateBlob, serverPatchUserStateBlob } from "../server-store";
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
import type { Rng } from "@/lib/utils/random";

const TOOL = "tool.card_decks";

async function browserState(): Promise<CardDecksState> {
  await ensureCardDecksHydrated();
  return readCardDecks();
}

async function serverState(userId: string): Promise<CardDecksState> {
  return normalizeCardDecks(await serverGetUserStateBlob(userId, CARD_DECKS_STORE_KEY));
}

/** A write verb's answer, and the state to save (null: nothing changes). */
interface Plan<O> {
  out: O;
  next: CardDecksState | null;
}

/** Run a planner on the browser's store and apply what it plans. */
async function inBrowser<O>(plan: (state: CardDecksState) => Plan<O>): Promise<O> {
  const { out, next } = plan(await browserState());
  if (next) updateCardDecks(() => next);
  return out;
}

/** Said when the saved decks are past the size the server may grow them to. */
const TOO_LARGE =
  "The saved decks are too big to change from here. Remove some cards or decks on /card-decks, then ask again.";

/**
 * Run a planner on the synced copy and save what it plans, with the same
 * compare-and-set as every server blob write. The planner may run more than
 * once (a lost race re-reads the row): the last run's answer is returned.
 */
async function onServer<O>(
  userId: string,
  plan: (state: CardDecksState) => Plan<O>,
  refused: (reason: string) => O
): Promise<O> {
  let out: O | undefined;
  const result = await serverPatchUserStateBlob(userId, CARD_DECKS_STORE_KEY, (raw) => {
    const p = plan(normalizeCardDecks(raw));
    out = p.out;
    return p.next && normalizeCardDecks(p.next);
  });
  if (!result.written && result.reason === "too_large") return refused(TOO_LARGE);
  return out as O;
}

/** What each write verb's description says about the MCP path. */
const MCP_NOTE =
  "Over MCP it is saved to the synced decks and an open /card-decks page picks it up, unless that tab has a change of its own not saved yet, which then wins.";

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
      /** What the round can still deal. */
      left: number;
    };

/**
 * Deal from the deck asked for (or the one on the table), which goes on the
 * table. Nothing changes when the deck is unknown or the round is done.
 */
function planDeal(
  state: CardDecksState,
  params: z.infer<typeof dealParams>,
  rng: Rng = Math.random
): Plan<DealOut> {
  const deck = findDeck(state.decks, params.deckId ?? state.deckId);
  if (!deck)
    return {
      out: {
        dealt: false,
        reason: `No deck "${params.deckId}". tool.card_decks.list_decks lists them.`,
      },
      next: null,
    };
  const marks = marksOf(state);
  const starredOnly = starredOnlyFor(state, deck);
  const result = dealCards(
    deck,
    marks,
    state.rounds[deck.id] ?? [],
    params.count ?? 1,
    rng,
    starredOnly
  );
  if (result.cards.length === 0)
    return {
      out: {
        dealt: false,
        reason:
          "No cards left to deal this round. Shuffle (tool.card_decks.shuffle) to start again.",
      },
      next: null,
    };
  return {
    out: {
      dealt: true,
      deck: { id: deck.id, name: deck.name },
      cards: result.cards.map(cardOut),
      left: roundProgress(deck, marks, result.round, starredOnly).left,
    },
    next: { ...state, deckId: deck.id, rounds: { ...state.rounds, [deck.id]: result.round } },
  };
}

registry.register({
  id: `${TOOL}.deal`,
  toolId: TOOL,
  name: "deal",
  category: "write",
  requiresConfirmation: false,
  description: `Deal cards at random onto Card Decks' table, from what the round can still deal (a card is dealt once a round; used and hidden cards never are; with "starred only" on, starred cards only). Params: {deckId? (default the deck on the table; another deck goes on the table), count?: 1-${CARD_DECK_LIMITS.hand} (default 1)}. Returns {dealt: true, deck: {id, name}, cards: {id, text, title?, hint?}[], left} or {dealt: false, reason} (none left: shuffle first). It doesn't show the cards to a live room: the host does that on the page. ${MCP_NOTE}`,
  paramsSchema: dealParams,
  handler: (params): Promise<DealOut> => inBrowser((s) => planDeal(s, params)),
  mcpHandler: (params, ctx): Promise<DealOut> =>
    onServer(
      ctx.userId,
      (s) => planDeal(s, params),
      (reason) => ({ dealt: false, reason })
    ),
});

/* ── shuffle ────────────────────────────────────────────────────────── */

type ShuffleOut =
  | { shuffled: false; reason: string }
  | { shuffled: true; deck: { id: string; name: string }; back: number };

const shuffleParams = z.object({
  deckId: z.string().max(64).optional().describe("Default: the deck on the table."),
});

/**
 * A new round of the deck asked for (or the one on the table): its deals are
 * forgotten. Nothing to save when the round hadn't started.
 */
function planShuffle(
  state: CardDecksState,
  params: z.infer<typeof shuffleParams>
): Plan<ShuffleOut> {
  const deck = findDeck(state.decks, params.deckId ?? state.deckId);
  if (!deck) return { out: { shuffled: false, reason: `No deck "${params.deckId}".` }, next: null };
  const round = state.rounds[deck.id];
  const out: ShuffleOut = {
    shuffled: true,
    deck: { id: deck.id, name: deck.name },
    back: dealtIds(round ?? []).length,
  };
  if (!round) return { out, next: null };
  const rounds = { ...state.rounds };
  delete rounds[deck.id];
  return { out, next: { ...state, rounds } };
}

registry.register({
  id: `${TOOL}.shuffle`,
  toolId: TOOL,
  name: "shuffle",
  category: "write",
  // Asks first (the write default): a shuffle forgets which cards the
  // meeting has had, and Amr's write has no Undo, unlike the page's Shuffle.
  description: `Start a new round of a Card Decks deck: every card dealt this round goes back (used and hidden cards stay set aside), and which cards were dealt is forgotten. Params: {deckId?}. Returns {shuffled: true, deck: {id, name}, back (cards returned)} or {shuffled: false, reason}. ${MCP_NOTE}`,
  paramsSchema: shuffleParams,
  handler: (params): Promise<ShuffleOut> => inBrowser((s) => planShuffle(s, params)),
  mcpHandler: (params, ctx): Promise<ShuffleOut> =>
    onServer(
      ctx.userId,
      (s) => planShuffle(s, params),
      (reason) => ({ shuffled: false, reason })
    ),
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

/** A refusal of add_card: nothing changes. */
const notAdded = (reason: string): Plan<AddCardResult> => ({
  out: { added: false, reason },
  next: null,
});

/**
 * Add the card to one of the team's own decks, or start a new deck with it
 * (which goes on the table). Built-in decks never change.
 */
function planAddCard(
  state: CardDecksState,
  params: z.infer<typeof addCardParams>
): Plan<AddCardResult> {
  if (params.newDeckName !== undefined) {
    // The store keeps CARD_DECK_LIMITS.decks decks: one more would be cut
    // when it is saved, and Amr would report a deck that doesn't exist.
    if (state.decks.length >= CARD_DECK_LIMITS.decks)
      return notAdded(
        `The team has ${CARD_DECK_LIMITS.decks} decks of its own, the most Card Decks keeps. Delete one on /card-decks first, or add the card to a deck they have.`
      );
    const card = validateCardDraft({ text: params.text }, null);
    if (!card.ok) return notAdded(card.errors.text ?? "That card can't be added.");
    const check = validateDeckDraft(
      { name: params.newDeckName, cards: card.values.text },
      state.decks
    );
    if (!check.ok) return notAdded(Object.values(check.errors).join(" "));
    const at = new Date().toISOString();
    const deck: CustomDeck = {
      id: `deck_${nanoid(10)}`,
      name: check.values.name,
      cards: [{ id: `c_${nanoid(10)}`, text: check.values.cards[0] }],
      createdAt: at,
      updatedAt: at,
    };
    return {
      out: {
        added: true,
        deckId: deck.id,
        deckName: deck.name,
        cardId: deck.cards[0].id,
        cards: 1,
        newDeck: true,
      },
      next: { ...state, decks: [...state.decks, deck], deckId: deck.id },
    };
  }
  const id = params.deckId ?? state.deckId;
  const deck = state.decks.find((d) => d.id === id);
  if (!deck) {
    const builtIn = findDeck(state.decks, id);
    return notAdded(
      builtIn
        ? `"${builtIn.name}" is a built-in deck and can't change. Give newDeckName to start a deck of the team's own.`
        : `No deck of the team's own with id "${id}". Give newDeckName to start one.`
    );
  }
  const check = validateCardDraft({ text: params.text }, deck);
  if (!check.ok) return notAdded(check.errors.text ?? "That card can't be added.");
  const card: DeckCard = { id: `c_${nanoid(10)}`, text: check.values.text };
  const at = new Date().toISOString();
  return {
    out: {
      added: true,
      deckId: deck.id,
      deckName: deck.name,
      cardId: card.id,
      cards: deck.cards.length + 1,
      newDeck: false,
    },
    next: {
      ...state,
      decks: state.decks.map((d) =>
        d.id === deck.id ? { ...d, cards: [...d.cards, card], updatedAt: at } : d
      ),
    },
  };
}

registry.register({
  id: `${TOOL}.add_card`,
  toolId: TOOL,
  name: "add_card",
  category: "write",
  description: `Add a card to one of the team's own Card Decks decks (built-in decks don't change), or start a new deck with it. Params: {text (1-${CARD_DECK_LIMITS.cardText} characters), deckId? (default the deck on the table, when it is the team's own), newDeckName? (start a deck of that name; names must be new)}. A card already in the deck is refused. Returns {added: true, deckId, deckName, cardId, cards, newDeck} or {added: false, reason}. ${MCP_NOTE}`,
  paramsSchema: addCardParams,
  handler: (params): Promise<AddCardResult> => inBrowser((s) => planAddCard(s, params)),
  mcpHandler: (params, ctx): Promise<AddCardResult> =>
    onServer(
      ctx.userId,
      (s) => planAddCard(s, params),
      (reason) => ({ added: false, reason })
    ),
});
