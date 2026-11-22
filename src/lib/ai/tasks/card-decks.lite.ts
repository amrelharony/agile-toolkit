/**
 * Card Decks' AI tasks, the lite half pages import (no zod; the defs, with
 * their schemas, are `card-decks.ts` and load on first AI use): the caps,
 * both fallbacks with their tone rules, and one ref per task.
 */

import { lazyAiTask } from "../task-ref";
import { hashSeed } from "@/lib/utils/random";
import { CARD_DECK_LIMITS, cleanLine, nearestBuiltInDeck } from "@/lib/card-decks/model";
import type {
  CardForMoodInput,
  CardForMoodOutput,
  GenerateCardsInput,
  GenerateCardsOutput,
} from "./card-decks";
export type {
  CardForMoodInput,
  CardForMoodOutput,
  GenerateCardsInput,
  GenerateCardsOutput,
} from "./card-decks";

export const GENERATE_MAX = 30;
export const MOOD_CARDS_MAX = 120;

// ── card-decks.generate ──────────────────────────────────────────────

const sentenceCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Cards without AI: from the built-in deck nearest the theme (by its name
 * and keywords; the retro prompts when none is near), starting at a place
 * the theme picks so two themes get different cards, skipping what the
 * deck already holds. The name is the theme.
 */
export function fallbackCards({
  theme,
  count,
  avoid = [],
}: GenerateCardsInput): GenerateCardsOutput {
  const deck = nearestBuiltInDeck(theme);
  const skip = new Set(avoid.map((a) => a.trim().toLowerCase()));
  const pool = deck.cards.map((c) => c.text).filter((t) => !skip.has(t.toLowerCase()));
  const from = pool.length > 0 ? hashSeed(theme.trim().toLowerCase()) % pool.length : 0;
  const ordered = [...pool.slice(from), ...pool.slice(0, from)];
  const cards = ordered.slice(0, Math.max(1, Math.min(GENERATE_MAX, count)));
  const name = sentenceCase(cleanLine(theme, CARD_DECK_LIMITS.deckName)) || deck.name;
  // A deck whose every card is already in use still answers with something.
  return { name, cards: cards.length > 0 ? cards : [deck.cards[0].text] };
}

export const generateCardsTask = lazyAiTask<GenerateCardsInput, GenerateCardsOutput>(
  { id: "card-decks.generate", toolId: "card-decks", fallback: fallbackCards },
  () => import("./card-decks").then((m) => m.generateCardsTask)
);

// ── card-decks.for_mood ──────────────────────────────────────────────

export const MOOD_TRENDS = ["falling", "steady", "rising", "unknown"] as const;
export type MoodTrend = (typeof MOOD_TRENDS)[number];

export type MoodBand = "low" | "middling" | "good" | "unknown";

/** Where the team's mood sits, from its average, trend and low run. */
export function moodBand(mood: CardForMoodInput["mood"]): MoodBand {
  const { average, trend, lowDays } = mood;
  if (lowDays >= 3) return "low";
  if (average === null) return "unknown";
  if (average <= 2.5 || (trend === "falling" && average < 3.2)) return "low";
  if (average >= 3.8) return "good";
  return "middling";
}

const GENTLE =
  /\b(help(?:ed|s)?|thank\w*|grateful|kind\w*|calm\w*|easier|support|welcome|proud|cheer|energy|strength|glad|best|well|appreciat\w*|celebrat\w*)\b/i;
const HARD =
  /\b(stop|wrong|mistakes?|slow(?:ed)?|cost|risks?|fail\w*|fell apart|disagree\w*|confusing|hard|waiting|put off|miss(?:ed)?|never change)\b/i;
const STRETCH =
  /\b(try|trying|experiment|change|differently|learn\w*|question|assum\w*|next step|smallest|option)\b/i;

const WEIGHTS: Readonly<Record<MoodBand, { gentle: number; hard: number; stretch: number }>> = {
  // A low mood wants a gentle card, not a push to try something.
  low: { gentle: 3, hard: -3, stretch: 0 },
  middling: { gentle: 1, hard: -1, stretch: 2 },
  good: { gentle: 0, hard: 2, stretch: 2 },
  unknown: { gentle: 1, hard: -1, stretch: 1 },
};

/** How well a card's words fit the band: gentle words for a low mood, harder ones for a good one. */
export function toneScore(text: string, band: MoodBand): number {
  const w = WEIGHTS[band];
  return (
    (GENTLE.test(text) ? w.gentle : 0) +
    (HARD.test(text) ? w.hard : 0) +
    (STRETCH.test(text) ? w.stretch : 0)
  );
}

const avg = (n: number) => `${Math.round(n * 10) / 10} of 5`;

function reasonFor(band: MoodBand, mood: CardForMoodInput["mood"]): string {
  switch (band) {
    case "low":
      return mood.average !== null
        ? `The team's mood has been low lately (${avg(mood.average)}), so this is a gentle card that starts from what helps.`
        : "The team's mood has been low for a few days, so this is a gentle card that starts from what helps.";
    case "good":
      return `The team's mood is good (${avg(mood.average ?? 4)}), a fair moment for a card that digs a little deeper.`;
    case "middling":
      return `The team's mood is middling (${avg(mood.average ?? 3)}): a card that invites a small change without weighing the room down.`;
    default:
      return "There aren't enough mood check-ins to go on, so this is a light card to start with.";
  }
}

/** A card without AI: the best tone fit for the mood band, the first such card on a tie. */
export function fallbackCardForMood(input: CardForMoodInput): CardForMoodOutput {
  const band = moodBand(input.mood);
  let best = input.cards[0];
  let bestScore = -Infinity;
  for (const card of input.cards) {
    const score = toneScore(card.text, band);
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return { cardId: best.id, reason: reasonFor(band, input.mood) };
}

export const cardForMoodTask = lazyAiTask<CardForMoodInput, CardForMoodOutput>(
  { id: "card-decks.for_mood", toolId: "card-decks", fallback: fallbackCardForMood },
  () => import("./card-decks").then((m) => m.cardForMoodTask)
);
