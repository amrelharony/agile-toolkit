/**
 * Product Goal's AI task, the def: draft up to three candidate Product
 * Goals, each with how to measure it, from the product vision and the
 * backlog's story titles. The person picks one into the form and edits it
 * before anything is saved. The fallback and the caps live in
 * `product-goal.lite.ts`, which pages import. The prompt lives in
 * `product-goal.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  GOAL_DRAFT_MAX,
  GOAL_DRAFT_MEASURES_MAX,
  GOAL_DRAFT_MEASURE_MAX,
  GOAL_DRAFT_STATEMENT_MAX,
  GOAL_DRAFT_STORIES_MAX,
  GOAL_DRAFT_WHY_MAX,
  productGoalDraftFallback,
} from "./product-goal.lite";

export {
  GOAL_DRAFT_MAX,
  GOAL_DRAFT_MEASURES_MAX,
  GOAL_DRAFT_STORIES_MAX,
  commonTheme,
  fallbackGoals,
  productGoalDraftFallback,
} from "./product-goal.lite";

const input = z.object({
  vision: z.string().trim().max(2000),
  stories: z.array(z.string().trim().min(1).max(200)).max(GOAL_DRAFT_STORIES_MAX),
  /** The goal being replaced, if any, so the drafts don't repeat it. */
  current: z.string().trim().max(1000).optional(),
});

const output = z.object({
  goals: z
    .array(
      z.object({
        statement: z.string().trim().min(1).max(GOAL_DRAFT_STATEMENT_MAX),
        why: z.string().trim().max(GOAL_DRAFT_WHY_MAX).optional(),
        measures: z
          .array(z.string().trim().min(1).max(GOAL_DRAFT_MEASURE_MAX))
          .max(GOAL_DRAFT_MEASURES_MAX),
      })
    )
    .min(1)
    .max(GOAL_DRAFT_MAX),
});

export type GoalDraftInput = z.infer<typeof input>;
export type GoalDraftOutput = z.infer<typeof output>;
export type DraftedGoal = GoalDraftOutput["goals"][number];

export const productGoalDraftTask = defineAiTask({
  id: "product-goal.draft",
  toolId: "product-goal",
  tier: "full",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: productGoalDraftFallback,
  sample: {
    vision:
      "Small shop owners take payments anywhere, without a card machine, and see their money the next day.",
    stories: [
      "Pay by phone with tap to pay",
      "Daily payout report",
      "Refund a payment from the phone",
      "Payout to a second bank account",
      "Offline payments queue",
    ],
  },
});
