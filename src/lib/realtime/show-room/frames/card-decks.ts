/**
 * Card Decks' show-room frames: frame kind → parser. Their renderers are in
 * `../renderers/card-decks.tsx`. Every tool also gets the generic "text"
 * frame.
 *
 *   "cards"  the cards the host dealt for the room: the deck's name and one
 *            to seven cards, each its text, plus an optional title (a split
 *            pattern, an activity's name) and hint.
 *
 * A parser takes the payload as JSON gave it and returns exactly what may
 * be drawn, rebuilt field by field, or null. Every string must already be
 * what `cleanText` makes of it, within its cap: the host builds the payload
 * with `cardsFrame`, which cleans and cuts its own text, so a payload the
 * parser would change was not built here and is refused. The whole frame
 * stays far under `SHOW_LIMITS.maxPayloadChars` (8,000): seven cards at
 * their caps come to about 3,500.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { cleanText, shareableText } from "../../sanitize";
import { obj } from "../../vote-room/wire";
import type { ShowFrameParsers } from "../frames";

export const CARDS_FRAME_KIND = "cards";

export const CARDS_FRAME_LIMITS = {
  maxCards: 7,
  maxDeckChars: 60,
  maxTextChars: 140,
  maxTitleChars: 60,
  maxHintChars: 200,
} as const;

/** One card as the room sees it. */
export interface CardsFrameCard {
  text: string;
  /** May be absent. */
  title?: string;
  hint?: string;
}

export interface CardsFrame {
  deck: string;
  cards: CardsFrameCard[];
}

/** `v` when it is exactly what `cleanText` makes of it within `max`, else null. */
function exact(v: unknown, max: number): string | null {
  const clean = cleanText(v, max);
  return clean !== null && clean === v ? clean : null;
}

/** An optional field: absent (undefined) is fine; present, it must be exact. */
function optional(v: unknown, max: number): string | undefined | null {
  if (v === undefined) return undefined;
  return exact(v, max);
}

/** A cards frame, or null. */
export function parseCardsFrame(raw: unknown): CardsFrame | null {
  const m = obj(raw);
  if (!m || !Array.isArray(m.cards)) return null;
  const deck = exact(m.deck, CARDS_FRAME_LIMITS.maxDeckChars);
  if (!deck) return null;
  const n = m.cards.length;
  if (n < 1 || n > CARDS_FRAME_LIMITS.maxCards) return null;
  const cards: CardsFrameCard[] = [];
  for (const row of m.cards) {
    const c = obj(row);
    if (!c) return null;
    const text = exact(c.text, CARDS_FRAME_LIMITS.maxTextChars);
    const title = optional(c.title, CARDS_FRAME_LIMITS.maxTitleChars);
    const hint = optional(c.hint, CARDS_FRAME_LIMITS.maxHintChars);
    if (!text || title === null || hint === null) return null;
    cards.push({ text, ...(title ? { title } : {}), ...(hint ? { hint } : {}) });
  }
  return { deck, cards };
}

/**
 * A cards frame from the host's own deck: each string cleaned and cut to
 * its cap, blank cards dropped, at most seven. Null when no card is left or
 * the deck has no name.
 */
export function cardsFrame(
  deck: string,
  cards: readonly { text: string; title?: string; hint?: string }[]
): CardsFrame | null {
  const name = shareableText(deck, CARDS_FRAME_LIMITS.maxDeckChars);
  if (!name) return null;
  const out: CardsFrameCard[] = [];
  for (const c of cards) {
    if (out.length >= CARDS_FRAME_LIMITS.maxCards) break;
    const text = shareableText(c.text ?? "", CARDS_FRAME_LIMITS.maxTextChars);
    if (!text) continue;
    const title = shareableText(c.title ?? "", CARDS_FRAME_LIMITS.maxTitleChars);
    const hint = shareableText(c.hint ?? "", CARDS_FRAME_LIMITS.maxHintChars);
    out.push({ text, ...(title ? { title } : {}), ...(hint ? { hint } : {}) });
  }
  return out.length > 0 ? { deck: name, cards: out } : null;
}

export const CARD_DECKS_FRAMES: ShowFrameParsers = {
  [CARDS_FRAME_KIND]: parseCardsFrame,
};
