/**
 * Planning Poker's AI task, the def: given the story being sized and up to
 * 40 finished stories (ids, titles, points), pick at most 3 that are most
 * alike, each with a short reason. The page shows the picks with the points
 * the store holds for them (never points from the answer) and writes
 * nothing. Without AI, title words answer (`pokerSimilarFallback` in
 * `planning-poker.lite.ts`, which pages import). The prompt lives in
 * `planning-poker.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  SIMILAR_CANDIDATES_MAX,
  SIMILAR_ID_MAX,
  SIMILAR_MATCHES_MAX,
  SIMILAR_NOTES_MAX,
  SIMILAR_POINTS_MAX,
  SIMILAR_TITLE_MAX,
  SIMILAR_WHY_MAX,
  pokerSimilarFallback,
} from "./planning-poker.lite";

export {
  SIMILAR_CANDIDATES_MAX,
  SIMILAR_ID_MAX,
  SIMILAR_MATCHES_MAX,
  SIMILAR_NOTES_MAX,
  SIMILAR_POINTS_MAX,
  SIMILAR_TITLE_MAX,
  SIMILAR_WHY_MAX,
  pokerSimilarFallback,
} from "./planning-poker.lite";

const input = z.object({
  story: z.object({
    title: z.string().trim().min(1).max(SIMILAR_TITLE_MAX),
    notes: z.string().max(SIMILAR_NOTES_MAX).optional(),
  }),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1).max(SIMILAR_ID_MAX),
        title: z.string().trim().min(1).max(SIMILAR_TITLE_MAX),
        points: z.number().min(0).max(SIMILAR_POINTS_MAX),
      })
    )
    .min(1)
    .max(SIMILAR_CANDIDATES_MAX),
});

const output = z.object({
  matches: z
    .array(
      z.object({
        /** A candidate's id, as given. */
        id: z.string().min(1).max(SIMILAR_ID_MAX),
        why: z.string().trim().max(SIMILAR_WHY_MAX),
      })
    )
    .max(SIMILAR_MATCHES_MAX),
});

export type PokerSimilarInput = z.infer<typeof input>;
export type PokerSimilarOutput = z.infer<typeof output>;

export const pokerSimilarTask = defineAiTask({
  id: "planning-poker.similar",
  toolId: "planning-poker",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: pokerSimilarFallback,
  sample: {
    story: {
      title: "Refund a card payment from the order page",
      notes: "Support staff refund a whole order or one item to the card it was paid with.",
    },
    candidates: [
      { id: "story_a1", title: "Card refunds for marketplace orders", points: 5 },
      { id: "story_b2", title: "Export the monthly sales report", points: 3 },
      { id: "story_c3", title: "Show the payment status on the order page", points: 2 },
      { id: "story_d4", title: "Reset a password by email", points: 3 },
    ],
  },
});
