/**
 * Card Decks' model: the saved state, read back field by field, and the pure
 * rules of the table (what can be dealt, a deal, going back one, a new
 * round), the deck form's checks, and the nearest built-in deck for a theme.
 *
 * The state (one tool store, `agile-toolkit:card-decks`, synced like other
 * tool stores) holds:
 *   - `decks`: the team's own decks;
 *   - `deckId`: the deck on the table;
 *   - `rounds`: per deck, this round's deals (card ids, oldest first). A card
 *     is dealt at most once a round; Shuffle starts a new round;
 *   - `used`, `starred`, `hidden`: card keys (`<deckId>/<cardId>`). A used
 *     card is skipped in later rounds too (the team has talked about it), a
 *     hidden one is never dealt, a starred one is easy to find again;
 *   - `starredOnly`: deal from the starred cards only.
 *
 * Pure and server-safe: the page and Amr's actions share every rule here.
 */

import type { Rng } from "@/lib/utils/random";
import type { Validation } from "@/lib/utils/form";
import {
  BUILT_IN_DECKS,
  DEFAULT_DECK_ID,
  builtInDeck,
  isBuiltInDeckId,
  type Deck,
  type DeckCard,
} from "./decks";

export { BUILT_IN_DECKS, DEFAULT_DECK_ID, type Deck, type DeckCard } from "./decks";

// ── Limits ───────────────────────────────────────────────────────────

export const CARD_DECK_LIMITS = {
  /** One card's text. */
  cardText: 140,
  /** A deck's name. */
  deckName: 60,
  /** Cards in one of the team's own decks. */
  deckCards: 80,
  /** The team's own decks. */
  decks: 40,
  /** Cards in one deal (a hand); also what one room frame carries. */
  hand: 7,
  /** Deals kept per deck and round. */
  deals: 200,
  /** Keys kept in each of used, starred and hidden. */
  marks: 2_000,
} as const;

const ID_MAX = 64;

/** One of the team's own decks, as saved. */
export interface CustomDeck {
  id: string;
  name: string;
  cards: DeckCard[];
  /** The theme it was written for, when Amr suggested it. */
  theme?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardDecksState {
  decks: CustomDeck[];
  deckId: string;
  /** Deck id → this round's deals, oldest first; each deal is card ids. */
  rounds: Record<string, string[][]>;
  used: string[];
  starred: string[];
  hidden: string[];
  starredOnly: boolean;
}

export const CARD_DECKS_INITIAL: CardDecksState = {
  decks: [],
  deckId: DEFAULT_DECK_ID,
  rounds: {},
  used: [],
  starred: [],
  hidden: [],
  starredOnly: false,
};

/** The tool store's name, and the key its cloud copy is saved under. */
export const CARD_DECKS_STORE = "card-decks";
export const CARD_DECKS_STORE_KEY = `agile-toolkit:${CARD_DECKS_STORE}`;

// ── Reading back ─────────────────────────────────────────────────────

/**
 * Controls, bidi marks and zero-width characters: the live room's own list
 * (CONTROL_OR_BIDI_RE in lib/realtime/sanitize) plus U+200B–U+200D and
 * U+FEFF, from `\u` escapes so the source stays ASCII. Written out here
 * because Amr's action modules, which import this one, may not import
 * realtime code (test/agent/actions-visitor-safe); test/card-decks/model
 * holds the two lists together.
 */
const HIDDEN_CHARS = new RegExp(
  "[\\u0000-\\u001F\\u007F\\u061C\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]",
  "g"
);

/**
 * One line of text: hidden characters taken out, spaces collapsed, cut to
 * `max` (never through a surrogate pair). "" when blank. What a room
 * participant's `cleanText` accepts as it is.
 */
export function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const flat = raw.replace(HIDDEN_CHARS, " ").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  let end = max;
  const last = flat.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return flat.slice(0, end).trimEnd();
}

const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= ID_MAX && !/[\s/]/.test(v);

function normalizeCard(raw: unknown): DeckCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!isId(c.id)) return null;
  const text = cleanLine(c.text, CARD_DECK_LIMITS.cardText);
  return text ? { id: c.id, text } : null;
}

function normalizeDeck(raw: unknown): CustomDeck | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!isId(d.id) || isBuiltInDeckId(d.id)) return null;
  const name = cleanLine(d.name, CARD_DECK_LIMITS.deckName);
  if (!name) return null;
  const seen = new Set<string>();
  const cards: DeckCard[] = [];
  for (const row of Array.isArray(d.cards) ? d.cards : []) {
    const card = normalizeCard(row);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
    if (cards.length >= CARD_DECK_LIMITS.deckCards) break;
  }
  const when = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : "");
  const createdAt = when(d.createdAt) || when(d.updatedAt) || new Date(0).toISOString();
  const theme = cleanLine(d.theme, CARD_DECK_LIMITS.deckName);
  return {
    id: d.id,
    name,
    cards,
    ...(theme ? { theme } : {}),
    createdAt,
    updatedAt: when(d.updatedAt) || createdAt,
  };
}

/** The team's own decks: valid ones, each id once, at most CARD_DECK_LIMITS.decks. */
export function normalizeDecks(raw: unknown): CustomDeck[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomDeck[] = [];
  for (const row of raw) {
    const deck = normalizeDeck(row);
    if (!deck || seen.has(deck.id)) continue;
    seen.add(deck.id);
    out.push(deck);
    if (out.length >= CARD_DECK_LIMITS.decks) break;
  }
  return out;
}

/** A card's key in used, starred and hidden. */
export const cardKey = (deckId: string, cardId: string) => `${deckId}/${cardId}`;

const isKey = (v: unknown): v is string =>
  typeof v === "string" && v.length <= ID_MAX * 2 + 1 && /^[^\s/]+\/[^\s/]+$/.test(v);

/** Card keys: well formed, each once, the newest CARD_DECK_LIMITS.marks kept. */
export function normalizeMarks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = Array.from(new Set(raw.filter(isKey)));
  return out.length > CARD_DECK_LIMITS.marks ? out.slice(-CARD_DECK_LIMITS.marks) : out;
}

/**
 * One deck's round: deals of card ids the deck holds, each card once in the
 * round, empty deals dropped, the newest CARD_DECK_LIMITS.deals kept.
 */
export function normalizeRound(raw: unknown, deck: Deck): string[][] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(deck.cards.map((c) => c.id));
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const deal of raw) {
    if (!Array.isArray(deal)) continue;
    const ids = deal.filter((id): id is string => {
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (ids.length > 0) out.push(ids.slice(0, CARD_DECK_LIMITS.hand));
  }
  return out.slice(-CARD_DECK_LIMITS.deals);
}

/** The team's own decks as decks: source "custom", no keywords. */
export function asDeck(deck: CustomDeck): Deck {
  return {
    id: deck.id,
    name: deck.name,
    blurb: deck.theme ? `Your deck on “${deck.theme}”.` : "Your own deck.",
    source: "custom",
    cards: deck.cards,
    keywords: [],
  };
}

/** Every deck: the built-in ones, then the team's own. */
export function allDecks(custom: readonly CustomDeck[]): Deck[] {
  return [...BUILT_IN_DECKS, ...custom.map(asDeck)];
}

/** A deck by id, built-in or the team's own. */
export function findDeck(custom: readonly CustomDeck[], id: string): Deck | undefined {
  const built = builtInDeck(id);
  if (built) return built;
  const own = custom.find((d) => d.id === id);
  return own ? asDeck(own) : undefined;
}

/** The whole state as read back: anything a sync or a hand edit could leave is cleaned. */
export function normalizeCardDecks(raw: unknown): CardDecksState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const decks = normalizeDecks(r.decks);
  const deckId =
    typeof r.deckId === "string" && findDeck(decks, r.deckId) ? r.deckId : DEFAULT_DECK_ID;
  const rounds: Record<string, string[][]> = {};
  const rawRounds = r.rounds && typeof r.rounds === "object" ? r.rounds : {};
  for (const [id, round] of Object.entries(rawRounds as Record<string, unknown>)) {
    const deck = findDeck(decks, id);
    if (!deck) continue;
    const clean = normalizeRound(round, deck);
    if (clean.length > 0) rounds[id] = clean;
  }
  return {
    decks,
    deckId,
    rounds,
    used: normalizeMarks(r.used),
    starred: normalizeMarks(r.starred),
    hidden: normalizeMarks(r.hidden),
    starredOnly: r.starredOnly === true,
  };
}

// ── The table ────────────────────────────────────────────────────────

/** Used, starred and hidden as sets of card keys. */
export interface Marks {
  used: ReadonlySet<string>;
  starred: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
}

export function marksOf(state: Pick<CardDecksState, "used" | "starred" | "hidden">): Marks {
  return {
    used: new Set(state.used),
    starred: new Set(state.starred),
    hidden: new Set(state.hidden),
  };
}

/** Card ids dealt in a round, in deal order. */
export const dealtIds = (round: readonly (readonly string[])[]): string[] => round.flat();

/**
 * The cards a deck can still deal this round: not hidden, not used, not
 * dealt already, and starred when `starredOnly` is on.
 */
export function dealableCards(
  deck: Deck,
  marks: Marks,
  round: readonly (readonly string[])[],
  starredOnly = false
): DeckCard[] {
  const dealt = new Set(dealtIds(round));
  return deck.cards.filter((c) => {
    const key = cardKey(deck.id, c.id);
    if (marks.hidden.has(key) || marks.used.has(key) || dealt.has(c.id)) return false;
    return !starredOnly || marks.starred.has(key);
  });
}

/** The cards in play (not hidden or used): what a full round deals, starred-only aside. */
export function activeCards(deck: Deck, marks: Marks, starredOnly = false): DeckCard[] {
  return dealableCards(deck, marks, [], starredOnly);
}

export interface DealResult {
  /** The cards dealt; empty when none was left. */
  cards: DeckCard[];
  /** The round with this deal added (the same round when nothing was dealt). */
  round: string[][];
}

/**
 * Deal `count` cards (1 to CARD_DECK_LIMITS.hand) at random from what the
 * round can still deal. Fewer come when fewer are left; none when the round
 * is done. Pure: `rng` decides.
 */
export function dealCards(
  deck: Deck,
  marks: Marks,
  round: readonly (readonly string[])[],
  count: number,
  rng: Rng,
  starredOnly = false
): DealResult {
  const n = Math.max(1, Math.min(CARD_DECK_LIMITS.hand, Math.floor(count) || 1));
  const pool = dealableCards(deck, marks, round, starredOnly);
  const cards: DeckCard[] = [];
  while (cards.length < n && pool.length > 0) {
    const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    cards.push(pool.splice(i, 1)[0]);
  }
  const base = round.map((d) => [...d]);
  if (cards.length === 0) return { cards, round: base };
  return { cards, round: [...base, cards.map((c) => c.id)].slice(-CARD_DECK_LIMITS.deals) };
}

/**
 * Deal one chosen card (the one Amr picked): null when the round can't deal
 * it (hidden, used, dealt already, or not in the deck).
 */
export function dealChosen(
  deck: Deck,
  marks: Marks,
  round: readonly (readonly string[])[],
  cardId: string
): DealResult | null {
  const card = dealableCards(deck, marks, round).find((c) => c.id === cardId);
  if (!card) return null;
  return {
    cards: [card],
    round: [...round.map((d) => [...d]), [card.id]].slice(-CARD_DECK_LIMITS.deals),
  };
}

/** The round without its last deal: those cards go back into the deck. */
export function backOne(round: readonly (readonly string[])[]): string[][] {
  return round.slice(0, -1).map((d) => [...d]);
}

/** The cards of the last deal, in the deck's current form (a removed card drops out). */
export function handOf(deck: Deck, round: readonly (readonly string[])[]): DeckCard[] {
  const last = round[round.length - 1];
  if (!last) return [];
  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  return last.map((id) => byId.get(id)).filter((c): c is DeckCard => Boolean(c));
}

export interface RoundProgress {
  /**
   * Cards in play dealt this round: a dealt card marked used or hidden since
   * (or not starred, under starred-only) no longer counts, so that
   * `dealt + left === inPlay` always.
   */
  dealt: number;
  /** Cards the round can still deal. */
  left: number;
  /** What a whole round deals: not used or hidden, and starred under starred-only. */
  inPlay: number;
  /** Cards in the deck. */
  total: number;
  /** Of `total`, used or hidden (never dealt). */
  setAside: number;
}

export function roundProgress(
  deck: Deck,
  marks: Marks,
  round: readonly (readonly string[])[],
  starredOnly = false
): RoundProgress {
  const setAside = deck.cards.filter((c) => {
    const key = cardKey(deck.id, c.id);
    return marks.hidden.has(key) || marks.used.has(key);
  }).length;
  const pool = activeCards(deck, marks, starredOnly);
  const dealtSet = new Set(dealtIds(round));
  const dealt = pool.filter((c) => dealtSet.has(c.id)).length;
  return {
    dealt,
    left: pool.length - dealt,
    inPlay: pool.length,
    total: deck.cards.length,
    setAside,
  };
}

/** Add or take out `key` (a toggle), keeping the cap. */
export function toggleMark(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : normalizeMarks([...list, key]);
}

/** The keys in `list` that belong to `deckId`. */
export const deckMarks = (list: readonly string[], deckId: string): string[] =>
  list.filter((k) => k.startsWith(`${deckId}/`));

// ── The deck form ────────────────────────────────────────────────────

export interface DeckDraft {
  name: string;
  /** One card per line. */
  cards: string;
}

export interface DeckValues {
  name: string;
  cards: string[];
}

/** The lines of a pasted list, one card each: cleaned, blanks and repeats dropped. */
export function cardLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const card = cleanLine(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""), Infinity);
    const key = card.toLowerCase();
    if (!card || seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

/**
 * A deck draft: a name (up to 60 characters, not a built-in deck's name)
 * and 1 to 80 cards of up to 140 characters each. A long line is an error,
 * never cut silently.
 */
export function validateDeckDraft(
  draft: DeckDraft,
  others: readonly { id: string; name: string }[] = [],
  selfId?: string
): Validation<DeckValues, keyof DeckDraft> {
  const errors: Partial<Record<keyof DeckDraft, string>> = {};
  const name = cleanLine(draft.name, Infinity);
  const taken = (n: string) =>
    [...BUILT_IN_DECKS, ...others.filter((d) => d.id !== selfId)].some(
      (d) => d.name.toLowerCase() === n.toLowerCase()
    );
  if (!name) errors.name = "Give the deck a name.";
  else if (name.length > CARD_DECK_LIMITS.deckName)
    errors.name = `Keep the name to ${CARD_DECK_LIMITS.deckName} characters.`;
  else if (taken(name)) errors.name = "A deck has that name already. Pick another.";

  const cards = cardLines(draft.cards);
  const long = cards.findIndex((c) => c.length > CARD_DECK_LIMITS.cardText);
  if (cards.length === 0) errors.cards = "Write at least one card, one per line.";
  else if (cards.length > CARD_DECK_LIMITS.deckCards)
    errors.cards = `A deck holds up to ${CARD_DECK_LIMITS.deckCards} cards; this has ${cards.length}.`;
  else if (long >= 0)
    errors.cards = `Card ${long + 1} is longer than ${CARD_DECK_LIMITS.cardText} characters. Shorten it.`;

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, values: { name, cards } };
}

export interface CardDraft {
  text: string;
}

/** One new card for a deck: 1 to 140 characters, not already in it. */
export function validateCardDraft(
  draft: CardDraft,
  deck: Pick<Deck, "cards"> | null
): Validation<{ text: string }, "text"> {
  const text = cleanLine(draft.text, Infinity);
  if (!text) return { ok: false, errors: { text: "Write the card first." } };
  if (text.length > CARD_DECK_LIMITS.cardText)
    return {
      ok: false,
      errors: { text: `Keep a card to ${CARD_DECK_LIMITS.cardText} characters.` },
    };
  if (deck && deck.cards.length >= CARD_DECK_LIMITS.deckCards)
    return {
      ok: false,
      errors: { text: `The deck is full: it holds ${CARD_DECK_LIMITS.deckCards} cards.` },
    };
  if (deck?.cards.some((c) => c.text.toLowerCase() === text.toLowerCase()))
    return { ok: false, errors: { text: "That card is in the deck already." } };
  return { ok: true, values: { text } };
}

/**
 * A deck's cards after an edit: a line that matches an old card's text
 * keeps that card's id (so its marks stay); a new line gets `newId()`.
 */
export function mergeCards(
  old: readonly DeckCard[],
  lines: readonly string[],
  newId: () => string
): DeckCard[] {
  const byText = new Map(old.map((c) => [c.text.toLowerCase(), c]));
  return lines.map((text) => {
    const prev = byText.get(text.toLowerCase());
    return prev ? { id: prev.id, text } : { id: newId(), text };
  });
}

// ── The nearest built-in deck (the AI fallback) ─────────────────────

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9:+-]+/)
    .filter((w) => w.length >= 3 || /\d/.test(w));

/**
 * The built-in deck whose name and keywords share most words with `theme`,
 * the retro prompts when none does. Prefix matches count ("retros" finds
 * "retro").
 */
export function nearestBuiltInDeck(theme: string): Deck {
  const asked = words(theme);
  const phrase = theme.toLowerCase();
  let best: Deck = builtInDeck(DEFAULT_DECK_ID) ?? BUILT_IN_DECKS[0];
  let bestScore = 0;
  for (const deck of BUILT_IN_DECKS) {
    let score = 0;
    for (const kw of [...deck.keywords, ...words(deck.name)]) {
      const k = kw.toLowerCase();
      if (k.includes(" ") || k.includes("-") || k.includes(":")) {
        if (phrase.includes(k)) score += 2;
      } else if (
        asked.some((w) => w === k || (w.length >= 4 && (w.startsWith(k) || k.startsWith(w))))
      )
        score += 1;
    }
    if (score > bestScore) {
      best = deck;
      bestScore = score;
    }
  }
  return best;
}
