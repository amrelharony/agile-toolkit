/**
 * The PI confidence vote, as the board keeps it: totals per point of the
 * 1–5 scale (never anyone's answer), for the whole train or one team. The
 * question each scope asks, the average, and the one rule the vote kit's
 * confidence format gives: talk through every vote under 3 before you
 * commit.
 *
 * Pure and server-safe: Amr's `tool.pi_planning.list_state` reads the
 * latest vote with it.
 */

import { fmt, plural } from "@/lib/charts/chart-text";
import { CONFIDENCE_POINTS, type PiConfidenceVote, type PiState } from "./model";

/** The scope of a vote by the whole train (any other scope is a team id). */
export const TRAIN_SCOPE = "train";
export const TRAIN_SCOPE_NAME = "Whole train";

/** The question a vote asks, for the train or one team. */
export function confidenceQuestion(teamName?: string): string {
  const name = teamName?.trim();
  return name
    ? `How confident are you that ${name} will meet its PI objectives?`
    : "How confident are you that we'll meet this PI's objectives?";
}

/** What a scope is called now: the train, the team's name, or the name it was saved under. */
export function scopeLabel(
  state: Pick<PiState, "teams">,
  scope: string,
  savedName?: string
): string {
  if (scope === TRAIN_SCOPE) return TRAIN_SCOPE_NAME;
  return state.teams.find((t) => t.id === scope)?.name || savedName || "A team";
}

/** The average answer, 1 to 5; null for no votes. */
export function voteAverage(counts: readonly number[]): number | null {
  const n = counts.reduce((a, c) => a + c, 0);
  if (n === 0) return null;
  return counts.reduce((a, c, i) => a + c * (i + 1), 0) / n;
}

/** The average to one decimal, as the page and Markdown show it. */
export const averageText = (counts: readonly number[]): string => {
  const avg = voteAverage(counts);
  return avg === null ? "—" : fmt(avg, 1);
};

/** Votes of 1 or 2. */
export const votesUnderThree = (counts: readonly number[]): number =>
  (counts[0] ?? 0) + (counts[1] ?? 0);

/** The format's rule: every vote under 3 is talked through before the train commits. */
export function confidenceRule(counts: readonly number[]): string {
  const low = votesUnderThree(counts);
  if (low === 0) return "Nobody voted under 3.";
  return `${plural(low, "vote")} under 3: talk ${low === 1 ? "it" : "them"} through before you commit.`;
}

/** The board's votes, newest last (as stored). */
export const confidenceVotes = (state: Pick<PiState, "confidence">): PiConfidenceVote[] =>
  state.confidence ?? [];

/** The latest vote, for one scope or any. */
export function latestVote(
  state: Pick<PiState, "confidence">,
  scope?: string
): PiConfidenceVote | undefined {
  const votes = confidenceVotes(state).filter((v) => scope === undefined || v.scope === scope);
  return votes[votes.length - 1];
}

/** The totals a saved round gives (its first question's), or null when they were withheld. */
export function countsFrom(result: {
  questions: readonly { distribution: readonly number[] | null }[];
}): number[] | null {
  const dist = result.questions[0]?.distribution;
  if (!dist || dist.length !== CONFIDENCE_POINTS) return null;
  if (dist.some((c) => !Number.isInteger(c) || c < 0)) return null;
  if (dist.reduce((a, c) => a + c, 0) === 0) return null;
  return [...dist];
}
