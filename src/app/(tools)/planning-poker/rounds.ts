/**
 * Vote history for Planning Poker stories.
 *
 * A story used to keep only its final estimate, so a split first round
 * and the re-vote that settled it were lost. The host now records each
 * revealed round on the story as it moves on (Vote Again or Accept
 * estimate); the export and the story card read them back.
 */

import { REDACTED_VOTE } from "./merge";
import { MAX_ROUNDS, type Participant, type Story } from "./types";

export function isNumeric(v: string): boolean {
  if (v === "?" || v === "∞") return false;
  if (v.trim() === "") return false;
  if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return false;
  return !isNaN(Number(v));
}

/** Low to high: numbers ascending, then anything else (T-shirt sizes,
 *  "?", "∞") in scale order, so XS…XXL reads naturally. */
export function sortVotes(votes: readonly string[], scale: readonly string[]): string[] {
  const rank = (v: string) => {
    const i = scale.indexOf(v);
    return i === -1 ? scale.length : i;
  };
  return [...votes].sort((a, b) => {
    const an = isNumeric(a);
    const bn = isNumeric(b);
    if (an && bn) return Number(a) - Number(b);
    if (an !== bn) return an ? -1 : 1;
    return rank(a) - rank(b);
  });
}

/** The votes on the table, minus empty seats and the pre-reveal sentinel. */
export function castVotes(participants: readonly Participant[]): string[] {
  return participants
    .map((p) => p.vote)
    .filter((v): v is string => v !== null && v.trim() !== "" && v !== REDACTED_VOTE);
}

/** `story` with one more round recorded; unchanged when nobody voted. */
export function withRound(story: Story, votes: readonly string[], scale: readonly string[]): Story {
  if (votes.length === 0) return story;
  return {
    ...story,
    rounds: [...(story.rounds ?? []), sortVotes(votes, scale)].slice(-MAX_ROUNDS),
  };
}
