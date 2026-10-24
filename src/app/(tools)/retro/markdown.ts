import type { BoardState, RetroCard } from "./types";
import type { FactLine } from "./facts-text";
import { themeCardTexts, type KeywordTheme } from "./themes";
import { sortedByVotes } from "./helpers";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A list item's text on one line. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** "Pair on flaky tests (3 votes)"; no count before anyone has voted. */
function withVotes(card: RetroCard): string {
  const text = oneLine(card.text);
  if (card.votes <= 0) return text;
  return `${text} (${card.votes} ${card.votes === 1 ? "vote" : "votes"})`;
}

export interface MarkdownExtra {
  /** The sprint the retro looks back on, for the title. */
  sprintName?: string;
  /** The facts the retro opened with (facts-text.ts). */
  facts?: readonly FactLine[];
  /** The board's common words (themes.ts). */
  themes?: readonly KeywordTheme[];
}

/** "- **Sprint goal:** Partly met: “…”." for each fact. */
function factsSection(facts: readonly FactLine[]): string[] {
  return ["", "## Facts", "", ...facts.map((f) => `- **${f.label}:** ${oneLine(f.sentence)}`)];
}

/** "- flaky (3 cards): Flaky UI tests; Flaky deploys; …" for each common word. */
function themesSection(themes: readonly KeywordTheme[], cards: readonly RetroCard[]): string[] {
  return [
    "",
    "## Common words",
    "",
    ...themes.map((t) => {
      const n = t.cardIds.length;
      const list = themeCardTexts(t, cards).map(oneLine);
      return `- ${oneLine(t.keyword)} (${n} ${n === 1 ? "card" : "cards"}): ${list.join("; ")}`;
    }),
  ];
}

/**
 * The retro board as Markdown, for the team wiki or the sprint channel: the
 * sprint in the title and the facts the retro opened with (when the board
 * has a sprint), one section per column (most-voted first, grouped cards
 * nested under their parent), the action items with their owners, then the
 * common words across the cards. The visitor room calls it with the board
 * alone.
 */
export function toMarkdown(
  state: Pick<BoardState, "format" | "cards">,
  now: Date = new Date(),
  extra: MarkdownExtra = {}
): string {
  const sprint = extra.sprintName ? oneLine(extra.sprintName) : "";
  const title = `# Retro — ${sprint ? `${sprint} — ` : ""}${mdDate(now)} (${oneLine(state.format.name)})`;
  const facts = extra.facts && extra.facts.length > 0 ? factsSection(extra.facts) : [];
  if (state.cards.length === 0) {
    return `${[title, ...facts].join("\n")}\n\nNo cards on the board yet.\n`;
  }

  const lines = [title, ...facts];
  for (const col of state.format.columns) {
    const cards = state.cards.filter((c) => c.columnKey === col.key);
    const top = sortedByVotes(cards.filter((c) => c.groupedWith === null));
    lines.push("", `## ${oneLine(col.label)}`, "");
    if (top.length === 0) {
      lines.push("No cards.");
      continue;
    }
    for (const card of top) {
      lines.push(`- ${withVotes(card)}`);
      for (const child of sortedByVotes(cards.filter((c) => c.groupedWith === card.id))) {
        lines.push(`  - ${withVotes(child)}`);
      }
    }
  }

  const actions = sortedByVotes(state.cards.filter((c) => c.isActionItem));
  lines.push("", "## Action items", "");
  if (actions.length === 0) lines.push("No action items yet.");
  for (const a of actions) {
    const owner = oneLine(a.assignee);
    lines.push(`- ${oneLine(a.text)} — ${owner ? `Owner: ${owner}` : "No owner yet"}`);
  }
  if (extra.themes && extra.themes.length > 0) {
    lines.push(...themesSection(extra.themes, state.cards));
  }
  return `${lines.join("\n")}\n`;
}
