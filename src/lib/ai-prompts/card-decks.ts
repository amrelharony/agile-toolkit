import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

/**
 * The copyable prompts for Card Decks (the AI Prompts drawer): more cards
 * like the deck on the table, and a short session plan built on it. The
 * deck's cards may be the team's own words, so they go in as data inside
 * `<user_content>`, each one cut to a card's length.
 */

export interface CardDecksPromptData {
  deck: { name: string; cards: readonly { text: string }[] };
  /** Cards dealt this round, in order. */
  dealt?: readonly { text: string }[];
}

/** Cards a prompt quotes at most. */
const MAX_CARDS = 40;

const list = (cards: readonly { text: string }[]) =>
  cards
    .slice(0, MAX_CARDS)
    .map((c) => `- ${sanitizePromptCell(c.text, 140)}`)
    .join("\n");

export function generateCardDecksPrompts(data: CardDecksPromptData): PromptDefinition[] {
  const { deck, dealt = [] } = data;
  if (deck.cards.length === 0) return [];
  const name = sanitizePromptCell(deck.name, 60);
  const more = deck.cards.length > MAX_CARDS ? `\n(and ${deck.cards.length - MAX_CARDS} more)` : "";
  const cards = wrapUserContent(`Deck: ${name}\n${list(deck.cards)}${more}`);
  const played =
    dealt.length > 0 ? `\n\nAlready dealt this round:\n${wrapUserContent(list(dealt), true)}` : "";

  return [
    {
      id: "card-decks-more",
      title: "Write more cards like these",
      description: "Twelve new cards in the same spirit, without repeating the deck.",
      prompt:
        buildPreamble("Card Decks", `The team uses a prompt-card deck called "${name}".`) +
        `## The deck\n\n${cards}\n\n## What to do\n\n1. Write 12 new cards in the same spirit: one open question or short prompt each, at most 140 characters, plain words.\n2. Don't repeat or reword the cards above.\n3. Mark the two you would deal first, and say why in one line each.\n4. Leave out anything that asks people for private details (health, money, family, beliefs).`,
    },
    {
      id: "card-decks-session",
      title: "Plan a session with this deck",
      description: "A 20-minute way to run these cards with the team.",
      prompt:
        buildPreamble(
          "Card Decks",
          `The facilitator wants to run a short session with the "${name}" deck.`
        ) +
        `## The deck\n\n${cards}${played}\n\n## What to do\n\n1. Suggest a 20-minute plan: how many cards, in what order, and how long per card.\n2. Pick the 3 to 5 cards from the deck that fit best, and say why.\n3. Give one way to make sure quieter people get to answer.\n4. Suggest how to close the session and what to write down.`,
    },
  ];
}
