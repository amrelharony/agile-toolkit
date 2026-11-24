/**
 * Audience Wall's AI tasks, the defs (prompts in `audience-wall.server.ts`;
 * pages import `audience-wall.lite.ts`, which holds the fallbacks and the
 * helpers). Each one reads anonymous posts only (their text, never who
 * wrote them) and answers a draft the host previews: nothing reaches the
 * room, the saved wall or the backlog until the host accepts it. Each has
 * a fallback that needs no model.
 *
 *   audience-wall.cluster          posts → up to 8 themes, each with its post ids
 *   audience-wall.merge_questions  posts → groups of duplicates to merge
 *   audience-wall.to_backlog       feedback → up to 10 backlog items
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import {
  AW_GROUPS_MAX,
  AW_ITEMS_MAX,
  AW_POSTS_MAX,
  AW_THEMES_MAX,
  fallbackBacklog,
  fallbackMerges,
  fallbackThemes,
} from "./audience-wall.lite";

export {
  AW_GROUPS_MAX,
  AW_ITEMS_MAX,
  AW_POSTS_MAX,
  AW_TEXT_BUDGET,
  AW_THEMES_MAX,
  aiPostBytes,
  aiPosts,
  cleanMerges,
  cleanThemes,
  fallbackBacklog,
  fallbackMerges,
  fallbackThemes,
  titleFromPost,
} from "./audience-wall.lite";

const postId = z.string().trim().min(1).max(12);
const post = z.object({ id: postId, text: z.string().trim().min(1).max(280) });

// ── cluster ──────────────────────────────────────────────────────────

const clusterInput = z.object({
  prompt: z.string().trim().max(280),
  posts: z.array(post).min(2).max(AW_POSTS_MAX),
});

const clusterOutput = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        postIds: z.array(postId).min(1).max(AW_POSTS_MAX),
      })
    )
    .min(1)
    .max(AW_THEMES_MAX),
});

export type ClusterInput = z.infer<typeof clusterInput>;
export type ClusterOutput = z.infer<typeof clusterOutput>;

export const clusterTask = defineAiTask({
  id: "audience-wall.cluster",
  toolId: "audience-wall",
  tier: "full",
  effort: "low",
  maxTokens: 8192,
  input: clusterInput,
  output: clusterOutput,
  fallback: fallbackThemes,
  sample: {
    prompt: "What slows us down the most?",
    posts: [
      { id: "p1", text: "Waiting for code reviews" },
      { id: "p2", text: "Reviews sit for two days" },
      { id: "p3", text: "Flaky end-to-end tests" },
      { id: "p4", text: "Tests fail at random on CI" },
      { id: "p5", text: "Too many status meetings" },
      { id: "p6", text: "Unclear priorities from stakeholders" },
    ],
  },
});

// ── merge_questions ──────────────────────────────────────────────────

const mergeInput = z.object({
  posts: z.array(post).min(2).max(AW_POSTS_MAX),
});

const mergeOutput = z.object({
  groups: z
    .array(
      z.object({
        keep: postId,
        merge: z.array(postId).min(1).max(10),
        reason: z.string().trim().max(140),
      })
    )
    .max(AW_GROUPS_MAX),
});

export type MergeInput = z.infer<typeof mergeInput>;
export type MergeOutput = z.infer<typeof mergeOutput>;

export const mergeQuestionsTask = defineAiTask({
  id: "audience-wall.merge_questions",
  toolId: "audience-wall",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: mergeInput,
  output: mergeOutput,
  fallback: fallbackMerges,
  sample: {
    posts: [
      { id: "p1", text: "When is the next release?" },
      { id: "p2", text: "When do we release next?" },
      { id: "p3", text: "Who owns the onboarding flow?" },
      { id: "p4", text: "Will the API change for partners?" },
    ],
  },
});

// ── to_backlog ───────────────────────────────────────────────────────

const backlogInput = z.object({
  prompt: z.string().trim().max(280),
  posts: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(280),
        votes: z.number().int().min(0).max(100_000),
      })
    )
    .min(1)
    .max(AW_POSTS_MAX),
});

const backlogOutput = z.object({
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500),
      })
    )
    .min(1)
    .max(AW_ITEMS_MAX),
});

export type BacklogInput = z.infer<typeof backlogInput>;
export type BacklogOutput = z.infer<typeof backlogOutput>;

export const toBacklogTask = defineAiTask({
  id: "audience-wall.to_backlog",
  toolId: "audience-wall",
  tier: "full",
  effort: "low",
  maxTokens: 6144,
  input: backlogInput,
  output: backlogOutput,
  fallback: fallbackBacklog,
  sample: {
    prompt: "What did you think of the new checkout?",
    posts: [
      { text: "The promo code box is hard to find", votes: 6 },
      { text: "Loved the one-page flow", votes: 4 },
      { text: "Card errors don't say what went wrong", votes: 5 },
      { text: "Can we save a second address?", votes: 2 },
    ],
  },
});
