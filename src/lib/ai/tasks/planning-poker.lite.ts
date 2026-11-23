/**
 * Planning Poker's AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `planning-poker.ts` and loads on first AI use): the
 * caps, the input builder, "like this one" without AI, and the ref.
 */

import { lazyAiTask } from "../task-ref";
import {
  SIMILAR_LIMIT,
  SIMILAR_MIN_SCORE,
  aiCandidates,
  rankSimilar,
  type SimilarTarget,
} from "@/lib/estimation/similar";
import type { Story } from "@/lib/stores/workspace-types";
import type { PokerSimilarInput, PokerSimilarOutput } from "./planning-poker";
export type { PokerSimilarInput, PokerSimilarOutput } from "./planning-poker";

export const SIMILAR_TITLE_MAX = 200;
export const SIMILAR_NOTES_MAX = 600;
export const SIMILAR_CANDIDATES_MAX = 40;
export const SIMILAR_ID_MAX = 64;
export const SIMILAR_POINTS_MAX = 1000;
export const SIMILAR_MATCHES_MAX = SIMILAR_LIMIT;
export const SIMILAR_WHY_MAX = 160;

const fitsId = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && id.length <= SIMILAR_ID_MAX;

/**
 * What the page sends: the story (title and the start of its notes) and up
 * to 40 finished stories to choose from, with their points from the store.
 * Only ids, titles and points leave the page, never notes of other stories.
 */
export function pokerSimilarInput(
  target: SimilarTarget,
  stories: readonly Story[]
): PokerSimilarInput {
  const usable = stories.filter(
    (s) => fitsId(s.id) && typeof s.points === "number" && s.points <= SIMILAR_POINTS_MAX
  );
  const notes = (target.notes ?? "").trim().slice(0, SIMILAR_NOTES_MAX);
  return {
    story: {
      title: target.title.trim().slice(0, SIMILAR_TITLE_MAX),
      ...(notes ? { notes } : {}),
    },
    candidates: aiCandidates(target, usable, SIMILAR_CANDIDATES_MAX).map((s) => ({
      id: s.id,
      title: s.title.trim().slice(0, SIMILAR_TITLE_MAX),
      points: s.points ?? 0,
    })),
  };
}

/** "Shares: refund, card", within the reason's cap. */
export function sharesLine(words: readonly string[]): string {
  return `Shares: ${words.join(", ")}`.slice(0, SIMILAR_WHY_MAX);
}

/**
 * Like this one without AI: the candidates that share title words with the
 * story, best first, each with the words they share. A candidate whose id
 * the answer couldn't carry is left out.
 *
 * It sees only what the request carries (no notes of other stories), so
 * the "Like this one" panel answers a fallback with its own word match,
 * which reads every story's notes, and never shows this one's narrower list.
 */
export const pokerSimilarFallback = ({
  story,
  candidates,
}: PokerSimilarInput): PokerSimilarOutput => ({
  matches: rankSimilar(
    story,
    candidates.filter((c) => fitsId(c.id))
  )
    .filter((s) => s.score > 0 && s.score >= SIMILAR_MIN_SCORE)
    .slice(0, SIMILAR_MATCHES_MAX)
    .map((s) => ({ id: s.item.id, why: sharesLine(s.shared) })),
});

export const pokerSimilarTask = lazyAiTask<PokerSimilarInput, PokerSimilarOutput>(
  {
    id: "planning-poker.similar",
    toolId: "planning-poker",
    fallback: pokerSimilarFallback,
  },
  () => import("./planning-poker").then((m) => m.pokerSimilarTask)
);
