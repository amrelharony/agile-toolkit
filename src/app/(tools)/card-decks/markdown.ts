import {
  cardKey,
  dealtIds,
  handOf,
  roundProgress,
  type Deck,
  type DeckCard,
  type Marks,
} from "@/lib/card-decks/model";

/** One line of Markdown text: line breaks folded, the characters that would start markup escaped. */
function md(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/([\\`*_[\]<>|])/g, "\\$1")
    .trim();
}

/** "12 Nov 2026" */
const mdDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const cardLine = (c: DeckCard) =>
  `${c.title ? `**${md(c.title)}:** ` : ""}${md(c.text)}${c.hint ? ` _(${md(c.hint)})_` : ""}`;

export interface CardDecksMarkdownInput {
  deck: Deck;
  marks: Marks;
  round: readonly (readonly string[])[];
  starredOnly?: boolean;
}

/**
 * The deck on the table as a page to paste into a meeting's notes: the
 * cards dealt now and this round, the starred ones, then every card with
 * its marks (used, starred, hidden).
 */
export function toMarkdown(
  { deck, marks, round, starredOnly = false }: CardDecksMarkdownInput,
  now: Date = new Date()
): string {
  const progress = roundProgress(deck, marks, round, starredOnly);
  const lines = [
    `# Card Decks: ${md(deck.name)} — ${mdDate(now)}`,
    "",
    md(deck.blurb),
    "",
    `${deck.cards.length} cards · ${progress.dealt} dealt this round · ${progress.left} left to deal${
      starredOnly ? " (starred only)" : ""
    }${progress.setAside > 0 ? ` · ${progress.setAside} used or hidden` : ""}`,
    "",
  ];

  const hand = handOf(deck, round);
  if (hand.length > 0) {
    lines.push("## On the table", "", ...hand.map((c) => `- ${cardLine(c)}`), "");
  }

  const byId = new Map(deck.cards.map((c) => [c.id, c]));
  const dealt = dealtIds(round)
    .map((id) => byId.get(id))
    .filter((c): c is DeckCard => Boolean(c));
  if (dealt.length > hand.length) {
    lines.push("## Dealt this round", "", ...dealt.map((c, i) => `${i + 1}. ${cardLine(c)}`), "");
  }

  const has = (set: ReadonlySet<string>, c: DeckCard) => set.has(cardKey(deck.id, c.id));
  const starred = deck.cards.filter((c) => has(marks.starred, c));
  if (starred.length > 0) {
    lines.push("## Starred", "", ...starred.map((c) => `- ${cardLine(c)}`), "");
  }

  lines.push("## All cards", "");
  deck.cards.forEach((c, i) => {
    const tags = [
      has(marks.used, c) && "used",
      has(marks.starred, c) && "starred",
      has(marks.hidden, c) && "hidden",
    ].filter(Boolean);
    lines.push(`${i + 1}. ${cardLine(c)}${tags.length > 0 ? ` (${tags.join(", ")})` : ""}`);
  });
  lines.push("");
  return lines.join("\n");
}
