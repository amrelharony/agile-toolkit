/**
 * Planning Poker's lobby form: the draft and its checks.
 *
 * Start Session used to grey out with no reason when a field was empty, and
 * a custom deck could hold values the room then rejects (`isValidSession`
 * caps a deck at 32 cards of 32 characters): every guest would drop the
 * whole session. The checks now say what's wrong, next to the field.
 */

import type { Validation } from "@/lib/utils/form";
import { estimateCards } from "@/lib/estimation/consensus";
import { DEFAULT_CUSTOM_DECK, SCALES, type ScaleType } from "./types";
import { DEFAULT_DISPLAY_NAME, DEFAULT_SESSION_NAME } from "./example";

/** What `isValidSession` accepts, so a session that starts here never gets dropped. */
export const SESSION_NAME_MAX = 200;
export const DISPLAY_NAME_MAX = 80;
export const DECK_MAX_CARDS = 32;
export const CARD_MAX_LENGTH = 32;

export interface LobbyDraft {
  sessionName: string;
  scaleType: ScaleType;
  /** The custom deck as typed: comma-separated values. */
  customInput: string;
  displayName: string;
}

export type LobbyField = "sessionName" | "customInput" | "displayName";

export interface StartValues {
  sessionName: string;
  scale: string[];
  scaleType: ScaleType;
  displayName: string;
}

export const INITIAL_LOBBY: LobbyDraft = {
  sessionName: DEFAULT_SESSION_NAME,
  scaleType: "fibonacci",
  customInput: DEFAULT_CUSTOM_DECK,
  displayName: DEFAULT_DISPLAY_NAME,
};

/** A typed custom deck as cards: split on commas, trimmed, blanks dropped. */
export function parseCustomDeck(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The deck the draft would play with. */
export function deckFor(d: Pick<LobbyDraft, "scaleType" | "customInput">): string[] {
  return d.scaleType === "custom" ? parseCustomDeck(d.customInput) : SCALES[d.scaleType];
}

/** Why a custom deck can't be played, or null when it can. */
export function customDeckError(cards: readonly string[]): string | null {
  if (cards.length < 2) return "Enter at least two values, separated by commas.";
  if (cards.length > DECK_MAX_CARDS) return `A deck holds up to ${DECK_MAX_CARDS} cards.`;
  const long = cards.find((c) => c.length > CARD_MAX_LENGTH);
  if (long) return `Keep each card to ${CARD_MAX_LENGTH} characters (“${long.slice(0, 12)}…”).`;
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c)) return `“${c}” is on the deck twice.`;
    seen.add(c);
  }
  if (estimateCards(cards).length === 0) return "Add at least one size, not only ? or ∞.";
  return null;
}

export function validateLobby(d: LobbyDraft): Validation<StartValues, LobbyField> {
  const errors: Partial<Record<LobbyField, string>> = {};
  const sessionName = d.sessionName.trim();
  const displayName = d.displayName.trim();
  if (!sessionName) errors.sessionName = "Name the session.";
  else if (sessionName.length > SESSION_NAME_MAX)
    errors.sessionName = `Keep the name to ${SESSION_NAME_MAX} characters.`;
  if (!displayName) errors.displayName = "Enter the name the others see.";
  else if (displayName.length > DISPLAY_NAME_MAX)
    errors.displayName = `Keep your name to ${DISPLAY_NAME_MAX} characters.`;
  const scale = deckFor(d);
  if (d.scaleType === "custom") {
    const deckError = customDeckError(scale);
    if (deckError) errors.customInput = deckError;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { sessionName, scale, scaleType: d.scaleType, displayName } };
}
