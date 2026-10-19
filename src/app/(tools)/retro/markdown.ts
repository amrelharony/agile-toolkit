import type { BoardState, RetroCard } from "./types";
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

/**
 * The retro board as Markdown, for the team wiki or the sprint channel: one
 * section per column (most-voted first, grouped cards nested under their
 * parent), then the action items with their owners.
 */
export function toMarkdown(
  state: Pick<BoardState, "format" | "cards">,
  now: Date = new Date()
): string {
  const title = `# Retro — ${mdDate(now)} (${oneLine(state.format.name)})`;
  if (state.cards.length === 0) return `${title}\n\nNo cards on the board yet.\n`;

  const lines = [title];
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
  return `${lines.join("\n")}\n`;
}
