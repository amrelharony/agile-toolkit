/**
 * Card Decks' AI tasks, the defs (the prompts are in `card-decks.server.ts`;
 * pages import `card-decks.lite.ts`, which holds the fallbacks):
 *
 *   card-decks.generate  a theme and a count (up to 30) → a deck name and
 *                        that many cards of up to 140 characters. Without
 *                        AI: cards from the nearest built-in deck.
 *   card-decks.for_mood  the team's mood (the anonymous team average from
 *                        Mood Tracker check-ins, never a person's) and the
 *                        deck's cards still to deal → one card id and why.
 *                        Without AI: tone rules on the cards' words.
 *
 * Nothing here writes: the page shows the answer, and the person adds the
 * cards (or deals the card) through the tool's store, with Undo.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { CARD_DECK_LIMITS } from "@/lib/card-decks/model";
import {
  GENERATE_MAX,
  MOOD_CARDS_MAX,
  MOOD_TRENDS,
  fallbackCardForMood,
  fallbackCards,
} from "./card-decks.lite";

export {
  GENERATE_MAX,
  MOOD_CARDS_MAX,
  MOOD_TRENDS,
  fallbackCardForMood,
  fallbackCards,
  moodBand,
  toneScore,
} from "./card-decks.lite";
export type { MoodBand, MoodTrend } from "./card-decks.lite";

const cardText = z.string().trim().min(1).max(CARD_DECK_LIMITS.cardText);

// ── card-decks.generate ──────────────────────────────────────────────

const generateInput = z.object({
  theme: z.string().trim().min(2).max(60),
  count: z.number().int().min(1).max(GENERATE_MAX),
  /** Cards the deck already holds, so the answer doesn't repeat them. */
  avoid: z.array(z.string().max(CARD_DECK_LIMITS.cardText)).max(40).optional(),
});

const generateOutput = z.object({
  name: z.string().trim().min(1).max(CARD_DECK_LIMITS.deckName),
  cards: z.array(cardText).min(1).max(GENERATE_MAX),
});

export type GenerateCardsInput = z.infer<typeof generateInput>;
export type GenerateCardsOutput = z.infer<typeof generateOutput>;

export const generateCardsTask = defineAiTask({
  id: "card-decks.generate",
  toolId: "card-decks",
  tier: "flash",
  effort: "low",
  maxTokens: 6144,
  input: generateInput,
  output: generateOutput,
  fallback: fallbackCards,
  sample: { theme: "Remote team trust", count: 8 },
});

// ── card-decks.for_mood ──────────────────────────────────────────────

const moodInput = z.object({
  mood: z.object({
    /** The team's mean, 1 rough … 5 great; null with too few check-ins. */
    average: z.number().min(1).max(5).nullable(),
    checkIns: z.number().int().min(0).max(100_000),
    trend: z.enum(MOOD_TRENDS),
    /** Days in a row the team average was low (0 when it isn't). */
    lowDays: z.number().int().min(0).max(366),
  }),
  deck: z.string().max(CARD_DECK_LIMITS.deckName),
  cards: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        text: z.string().min(1).max(CARD_DECK_LIMITS.cardText),
      })
    )
    .min(1)
    .max(MOOD_CARDS_MAX),
});

const moodOutput = z.object({
  cardId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1).max(240),
});

export type CardForMoodInput = z.infer<typeof moodInput>;
export type CardForMoodOutput = z.infer<typeof moodOutput>;

export const cardForMoodTask = defineAiTask({
  id: "card-decks.for_mood",
  toolId: "card-decks",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: moodInput,
  output: moodOutput,
  fallback: fallbackCardForMood,
  sample: {
    mood: { average: 2.3, checkIns: 14, trend: "falling", lowDays: 3 },
    deck: "Retro prompts",
    cards: [
      { id: "retro-07", text: "What is one thing we should stop doing?" },
      { id: "retro-01", text: "What helped us most this sprint?" },
      { id: "retro-23", text: "What is one small experiment we could run next sprint?" },
    ],
  },
});
