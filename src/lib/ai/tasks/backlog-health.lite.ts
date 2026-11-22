/**
 * Backlog Health's AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `backlog-health.ts` and loads on first AI use): the
 * caps and flag labels, the review without AI, `fitReviewInput`, and the ref.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_VISITOR_MAX_BODY_BYTES } from "../contract";
import {
  DEEP_TOP_N,
  STORY_FLAG_LABEL,
  TOO_BIG_POINTS,
  draftScenarios,
  isVagueTitle,
  splitPatternsFor,
  splitTitles,
} from "@/lib/backlog/health";
import type { ReviewInput, ReviewOutput, ReviewedStory } from "./backlog-health";
export type { ReviewInput, ReviewOutput, ReviewedStory } from "./backlog-health";

export const REVIEW_STORIES_MAX = 40;
export const REVIEW_ANSWERS_MAX = 20;
export const REVIEW_SPLITS_MAX = 4;
export const REVIEW_GWT_MAX = 3;

/** The flags the AI may raise: the page's own, by id. */
export const REVIEW_FLAGS = [
  "vague",
  "no-criteria",
  "too-big",
  "unclear-value",
  "not-testable",
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export const REVIEW_FLAG_LABEL: Record<ReviewFlag, string> = {
  vague: STORY_FLAG_LABEL.vague,
  "no-criteria": STORY_FLAG_LABEL["no-criteria"],
  "too-big": STORY_FLAG_LABEL["too-big"],
  "unclear-value": "Unclear value",
  "not-testable": "Hard to test",
};

/**
 * The review without AI: the page's rules for each story (a vague title,
 * no criteria near the top, more points than `tooBigPoints`), two split
 * patterns' titles for a big story, and starting scenarios for a top one
 * with no criteria. Stories that need nothing are left out.
 */
export function fallbackReview({
  stories,
  topN = DEEP_TOP_N,
  tooBigPoints = TOO_BIG_POINTS,
}: ReviewInput): ReviewOutput {
  const out: ReviewedStory[] = [];
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
    if (out.length >= REVIEW_ANSWERS_MAX) break;
    const flags: ReviewedStory["flags"] = [];
    const vague = isVagueTitle(s.title);
    // Only the top of the backlog needs criteria; further down can stay rough.
    const noCriteria = i < topN && !s.criteria?.trim();
    const big = typeof s.points === "number" && s.points > tooBigPoints;
    if (vague)
      flags.push({ flag: "vague", reason: "The title is too short or general to build from." });
    if (noCriteria)
      flags.push({
        flag: "no-criteria",
        reason: "Nothing says how the team will know it is done.",
      });
    if (big)
      flags.push({
        flag: "too-big",
        reason: `${s.points} points is more than a sprint should take on one story.`,
      });
    if (flags.length === 0) continue;
    const splits = big
      ? splitPatternsFor(s.title)
          .flatMap((p) => splitTitles(s.title, p.id))
          .slice(0, REVIEW_SPLITS_MAX)
      : [];
    const gwt = noCriteria ? draftScenarios(s.title).slice(0, REVIEW_GWT_MAX) : [];
    out.push({ id: s.id, flags, splits, gwt });
  }
  return { stories: out };
}

export const backlogHealthReviewTask = lazyAiTask<ReviewInput, ReviewOutput>(
  { id: "backlog-health.review", toolId: "backlog-health", fallback: fallbackReview },
  () => import("./backlog-health").then((m) => m.backlogHealthReviewTask)
);

/** What a review request may weigh, in UTF-8 bytes: the visitor route's cap, less room for the envelope. */
export const REVIEW_BODY_BUDGET = TOOL_AI_VISITOR_MAX_BODY_BYTES - 4 * 1024;

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * The review's input, trimmed until its request (`{task, input}`) fits
 * `budget` bytes: descriptions go first, from the bottom of the backlog up,
 * then whole stories from the bottom. The top stories keep their criteria,
 * which the flags depend on. The input as it is when it already fits.
 */
export function fitReviewInput(input: ReviewInput, budget = REVIEW_BODY_BUDGET): ReviewInput {
  const size = (stories: ReviewInput["stories"]) =>
    bytes({ task: "backlog-health.review", input: { ...input, stories } });
  let stories = input.stories;
  if (size(stories) <= budget) return input;
  stories = stories.map((s) => ({ ...s }));
  for (let i = stories.length - 1; i >= 0 && size(stories) > budget; i--) {
    delete stories[i].description;
  }
  while (stories.length > 1 && size(stories) > budget) stories = stories.slice(0, -1);
  return { ...input, stories };
}
