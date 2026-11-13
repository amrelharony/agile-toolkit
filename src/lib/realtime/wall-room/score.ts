/**
 * Wall rooms, 25/10 rounds: which posts a person scores, and the top list.
 * Pure and server-safe.
 *
 * Each person scores five posts that aren't theirs, picked at random from
 * the wall. The pick is seeded by the round's id and a value only the
 * person's tab holds (`seed`: its tab secret, never shared with the room),
 * so nobody else can work out which five someone scores, and the same tab
 * gets the same five again. Every post on the wall is shuffled first and
 * their own posts are dropped after, so knowing one more or one fewer of
 * their own posts changes as little as possible. The host only caps how
 * many posts one person scores; who scored which post stays in its memory.
 */

import { createRng, shuffle } from "@/lib/utils/random";
import { WALL_LIMITS, type WallPost } from "./protocol";

export interface PostsToScoreOptions {
  roundId: string;
  /** The person's member id: the seed when there is no `seed`. */
  selfId: string;
  /** A value only this tab holds (its secret): what the pick is seeded with. */
  seed?: string;
  /** Their own posts (never scored by them). */
  mine?: ReadonlySet<string>;
  /** How many; default `WALL_LIMITS.scoresPerMember`. */
  count?: number;
}

/** The ids of the posts this person scores: up to five, none of their own. */
export function postsToScore(
  posts: readonly Pick<WallPost, "id">[],
  { roundId, selfId, seed, mine, count = WALL_LIMITS.scoresPerMember }: PostsToScoreOptions
): string[] {
  const ids = posts.map((p) => p.id).sort();
  return shuffle(ids, createRng(`${roundId}:${seed ?? selfId}`))
    .filter((id) => !mine?.has(id))
    .slice(0, Math.max(0, count));
}

/** A 25/10 total in words: "4.2 on average from 5 people", or "Not scored". */
export function scoreText(p: { score?: number; scorers?: number }): string {
  if (!p.scorers) return "Not scored";
  const avg = Math.round(((p.score ?? 0) / p.scorers) * 10) / 10;
  return `${avg} on average from ${p.scorers} ${p.scorers === 1 ? "person" : "people"}`;
}
