/**
 * Backlog Health's AI task, the def: review up to 40 backlog stories and
 * say, for the ones that need it, what is wrong (a flag with a reason), how
 * to split a big one (smaller titles) and Given/When/Then scenarios to
 * start its criteria from. The person accepts each suggestion into the
 * story, with Undo; nothing is written by the answer itself.
 *
 * Without AI it answers from the page's own rules (lib/backlog/health
 * `storyFlags`) and the five split patterns (refinement/invest
 * `SPLIT_PATTERNS`), with the page's settings: only the top `topN` stories
 * need criteria, and "too big" is above `tooBigPoints`. That fallback, the
 * caps and `fitReviewInput` live in `backlog-health.lite.ts`, which pages
 * import. The prompt lives in `backlog-health.server.ts`.
 *
 * `fitReviewInput` trims what the page sends to fit the visitor route's
 * body cap, which 40 long stories in a non-Latin script can pass.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  REVIEW_ANSWERS_MAX,
  REVIEW_FLAGS,
  REVIEW_GWT_MAX,
  REVIEW_SPLITS_MAX,
  REVIEW_STORIES_MAX,
  fallbackReview,
} from "./backlog-health.lite";

export {
  REVIEW_ANSWERS_MAX,
  REVIEW_BODY_BUDGET,
  REVIEW_FLAGS,
  REVIEW_FLAG_LABEL,
  REVIEW_GWT_MAX,
  REVIEW_SPLITS_MAX,
  REVIEW_STORIES_MAX,
  fallbackReview,
  fitReviewInput,
} from "./backlog-health.lite";
export type { ReviewFlag } from "./backlog-health.lite";

const input = z.object({
  stories: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(60),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(500).optional(),
        points: z.number().min(0).max(1000).optional(),
        criteria: z.string().trim().max(500).optional(),
      })
    )
    .min(1)
    .max(REVIEW_STORIES_MAX),
  /** How many stories, from the first, count as the top: only they need criteria. */
  topN: z.number().int().min(1).max(50).optional(),
  /** Points above which a story is too big. */
  tooBigPoints: z.number().int().min(1).max(100).optional(),
});

const part = z.string().trim().min(1).max(300);

const output = z.object({
  stories: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(60),
        flags: z
          .array(
            z.object({ flag: z.enum(REVIEW_FLAGS), reason: z.string().trim().min(1).max(200) })
          )
          .max(4),
        splits: z.array(z.string().trim().min(1).max(200)).max(REVIEW_SPLITS_MAX),
        gwt: z.array(z.object({ given: part, when: part, then: part })).max(REVIEW_GWT_MAX),
      })
    )
    .max(REVIEW_ANSWERS_MAX),
});

export type ReviewInput = z.infer<typeof input>;
export type ReviewOutput = z.infer<typeof output>;
export type ReviewedStory = ReviewOutput["stories"][number];

export const backlogHealthReviewTask = defineAiTask({
  id: "backlog-health.review",
  toolId: "backlog-health",
  tier: "full",
  effort: "high",
  maxTokens: 8192,
  input,
  output,
  fallback: fallbackReview,
  sample: {
    stories: [
      {
        id: "story_a",
        title: "Pay with a saved card",
        description: "Returning shoppers pay without typing their card again.",
        points: 5,
      },
      { id: "story_b", title: "Fix checkout", points: 3 },
      {
        id: "story_c",
        title: "Import orders from CSV and Excel files with currency conversion",
        points: 21,
        criteria: "Both file types import; amounts show in the shop's currency.",
      },
    ],
  },
});
