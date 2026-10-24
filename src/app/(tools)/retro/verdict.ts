import { listAnd, plural } from "@/lib/charts/chart-text";
import type { RetroFacts } from "@/lib/retro/facts";
import { goalClause } from "./facts-text";
import { shortText } from "./helpers";
import { MAX_VOTES, type BoardState, type RetroCard } from "./types";

const quote = (card: RetroCard) => `“${shortText(card.text)}”`;

/** The top-level cards with the most votes (several on a tie), and that count. */
function leaders(cards: readonly RetroCard[]): { top: RetroCard[]; votes: number } {
  const tops = cards.filter((c) => c.groupedWith === null);
  const votes = Math.max(0, ...tops.map((c) => c.votes));
  return { top: votes > 0 ? tops.filter((c) => c.votes === votes) : [], votes };
}

/** "“A” and “B”", or "“A”, “B” and 2 more" past three. */
function names(cards: readonly RetroCard[]): string {
  const shown = cards.slice(0, 3).map((c) => quote(c));
  const rest = cards.length - shown.length;
  return listAnd(rest > 0 ? [...shown, `${rest} more`] : shown);
}

/**
 * The one sentence above the columns: where the retro stands in its phase.
 *
 *   Write    "12 cards in 3 columns; Sprint 12 partly met its goal."
 *   Vote     "9 votes cast; “Flaky tests” leads with 4."
 *   Discuss  "Discuss “Flaky tests” first (4 votes)."
 *   Actions  "3 actions agreed, 1 without an owner."
 */
export function retroVerdict(
  state: Pick<BoardState, "phase" | "cards" | "format">,
  facts?: Pick<RetroFacts, "sprintName" | "goalOutcome"> | null
): string {
  const tops = state.cards.filter((c) => c.groupedWith === null);
  switch (state.phase) {
    case "write": {
      if (tops.length === 0) {
        return facts
          ? `No cards yet: start with what happened in ${facts.sprintName}.`
          : "No cards yet: start with what happened since the last retro.";
      }
      const keys = new Set(state.format.columns.map((c) => c.key));
      const used = new Set(tops.map((c) => c.columnKey).filter((k) => keys.has(k))).size;
      const lead = `${plural(tops.length, "card")} in ${plural(used, "column")}`;
      const goal = facts ? goalClause(facts.sprintName, facts.goalOutcome) : null;
      return goal ? `${lead}; ${goal}.` : `${lead}.`;
    }
    case "vote": {
      const cast = state.cards.reduce((sum, c) => sum + Math.max(0, c.votes), 0);
      if (cast === 0) {
        return `No votes yet: each person has ${MAX_VOTES} votes for the cards that matter most.`;
      }
      const { top, votes } = leaders(state.cards);
      if (top.length === 0) return `${plural(cast, "vote")} cast.`;
      return top.length === 1
        ? `${plural(cast, "vote")} cast; ${names(top)} leads with ${votes}.`
        : `${plural(cast, "vote")} cast; ${names(top)} lead with ${votes} each.`;
    }
    case "discuss": {
      const { top, votes } = leaders(state.cards);
      if (tops.length === 0) return "No cards to discuss.";
      if (top.length === 0) {
        return "Nobody voted, so discuss the cards in the order the team picks.";
      }
      return top.length === 1
        ? `Discuss ${names(top)} first (${plural(votes, "vote")}).`
        : `${names(top)} tie at ${plural(votes, "vote")}: start with ${top.length === 2 ? "either" : "any of them"}.`;
    }
    case "actions": {
      const actions = state.cards.filter((c) => c.isActionItem);
      if (actions.length === 0) {
        return "No actions agreed yet: mark the cards the team will act on.";
      }
      const unowned = actions.filter((c) => !(c.assignee ?? "").trim()).length;
      if (unowned === 0) return `${plural(actions.length, "action")} agreed, each with an owner.`;
      return `${plural(actions.length, "action")} agreed, ${unowned} without an owner.`;
    }
    default:
      // A phase this version doesn't know (a newer client's board): just count.
      return `${plural(tops.length, "card")} on the board.`;
  }
}
