/**
 * Wall rooms, 25/10 rounds: which posts a person scores, and the top list.
 * Pure and server-safe.
 *
 * Each person scores five posts that aren't theirs, picked at random from
 * the wall, but the same five every time for that person in that round
 * (seeded by the round's id and their member id), so a reload or a late
 * render doesn't hand them a new set. The host only caps how many posts
 * one person scores; who scored which post stays in its memory.
 */

import { createRng, shuffle } from "@/lib/utils/random";
import { WALL_LIMITS, type WallPost } from "./protocol";

export interface PostsToScoreOptions {
  roundId: string;
  /** The person's member id. */
  selfId: string;
  /** Their own posts (never scored by them). */
  mine?: ReadonlySet<string>;
  /** How many; default `WALL_LIMITS.scoresPerMember`. */
  count?: number;
}

/** The ids of the posts this person scores: up to five, none of their own. */
export function postsToScore(
  posts: readonly Pick<WallPost, "id">[],
  { roundId, selfId, mine, count = WALL_LIMITS.scoresPerMember }: PostsToScoreOptions
): string[] {
  const ids = posts
    .map((p) => p.id)
    .filter((id) => !mine?.has(id))
    .sort();
  return shuffle(ids, createRng(`${roundId}:${selfId}`)).slice(0, Math.max(0, count));
}

/** A 25/10 total in words: "4.2 on average from 5 people", or "Not scored". */
export function scoreText(p: { score?: number; scorers?: number }): string {
  if (!p.scorers) return "Not scored";
  const avg = Math.round(((p.score ?? 0) / p.scorers) * 10) / 10;
  return `${avg} on average from ${p.scorers} ${p.scorers === 1 ? "person" : "people"}`;
}
