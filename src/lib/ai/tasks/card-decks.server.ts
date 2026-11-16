/**
 * Card Decks' AI prompts (server half). The runner adds the agile-only scope
 * rule, the guardrail and the JSON-shape line, and wraps `user()` in
 * `<user_content>` tags: deck and card text is the team's own, so it is data.
 */

import "server-only";
import { defineAiPrompt } from "../define-task";
import { CARD_DECK_LIMITS } from "@/lib/card-decks/model";
import { GENERATE_MAX, cardForMoodTask, generateCardsTask } from "./card-decks";

export const generateCardsPrompt = defineAiPrompt(generateCardsTask, {
  system: [
    "You write prompt cards for agile team meetings: retrospectives, check-ins, coaching conversations and refinement.",
    `Given a theme and a number, write that many distinct cards (at most ${GENERATE_MAX}).`,
    `Each card is one open question or one short prompt of at most ${CARD_DECK_LIMITS.cardText} characters that a team can answer aloud.`,
    "Plain words, sentence case, no numbering, no emoji, no hashtags, no names of real people or companies.",
    "Never ask people to share private or sensitive details such as health, money, family or beliefs.",
    "Do not repeat or reword the cards listed as already in the deck.",
    `Also give the deck a short name of at most ${CARD_DECK_LIMITS.deckName} characters.`,
  ].join(" "),
  user: ({ theme, count, avoid }) =>
    [
      `Theme: ${theme}`,
      `Number of cards: ${count}`,
      ...(avoid && avoid.length > 0
        ? ["Already in the deck:", ...avoid.map((card) => `- ${card}`)]
        : []),
    ].join("\n"),
});

export const cardForMoodPrompt = defineAiPrompt(cardForMoodTask, {
  system: [
    "You help a facilitator pick the next card to deal in a team meeting.",
    "You get the team's mood from anonymous check-ins (the team's average from 1, rough, to 5, great, or unknown when there are too few), its trend, how many days in a row it was low, and the cards still in the deck with their ids.",
    "Pick exactly one card from the list that fits the mood: gentle and appreciative when the mood is low or falling, a deeper or more challenging question when it is good.",
    "The cardId must be one of the ids in the list, copied exactly.",
    "Give the reason in one or two short plain sentences, without guessing about any one person.",
  ].join(" "),
  user: ({ mood, deck, cards }) =>
    [
      `Deck: ${deck}`,
      `Team mood: ${mood.average === null ? "unknown" : `${mood.average} of 5`} (from ${mood.checkIns} check-ins)`,
      `Trend: ${mood.trend}`,
      `Low days in a row: ${mood.lowDays}`,
      "Cards (id: text):",
      ...cards.map((card) => `${card.id}: ${card.text}`),
    ].join("\n"),
});
