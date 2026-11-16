import { exampleId } from "@/lib/utils/example-id";
import type { CustomDeck } from "@/lib/card-decks/model";

/**
 * A team's own deck for an offsite: eight openers, the first one already
 * dealt, so the table, the deck list and the export all show something.
 * Every id starts with `example-`, so Clear example removes exactly the
 * deck, its round and its marks, never the team's own decks.
 */

export const EXAMPLE_DECK_ID = exampleId("deck-offsite");

const CARDS = [
  "What is one thing about how we work that you would never change?",
  "Which part of your job would you most like to show the rest of us?",
  "What did you learn this quarter that surprised you?",
  "If we could drop one meeting for a month, which one would it be?",
  "What does a really good week look like for you?",
  "Which story from a user this year should everyone hear?",
  "What would you like more of from this team next quarter?",
  "Where do you go when you need to think something through?",
];

export function buildExample(now: Date = new Date()): { deck: CustomDeck; round: string[][] } {
  const at = now.toISOString();
  const deck: CustomDeck = {
    id: EXAMPLE_DECK_ID,
    name: "Team offsite openers",
    cards: CARDS.map((text, i) => ({ id: exampleId(`offsite-${i + 1}`), text })),
    createdAt: at,
    updatedAt: at,
  };
  return { deck, round: [[deck.cards[0].id]] };
}
