/**
 * Product Goal's AI task, the browser-safe half: draft up to three candidate
 * Product Goals, each with how to measure it, from the product vision and
 * the backlog's story titles. The person picks one into the form and edits
 * it before anything is saved. The prompt lives in `product-goal.server.ts`.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";

export const GOAL_DRAFT_MAX = 3;
export const GOAL_DRAFT_STORIES_MAX = 30;
export const GOAL_DRAFT_MEASURES_MAX = 4;

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
        statement: z.string().trim().min(1).max(300),
        why: z.string().trim().max(500).optional(),
        measures: z.array(z.string().trim().min(1).max(200)).max(GOAL_DRAFT_MEASURES_MAX),
      })
    )
    .min(1)
    .max(GOAL_DRAFT_MAX),
});

export type GoalDraftInput = z.infer<typeof input>;
export type GoalDraftOutput = z.infer<typeof output>;
export type DraftedGoal = GoalDraftOutput["goals"][number];

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** The vision's first sentence, lower-cased at the start, for a template. */
function visionClause(vision: string): string {
  const first =
    vision
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? "";
  const clause = first.replace(/[.!?]+$/, "").trim();
  return clause ? clause.charAt(0).toLowerCase() + clause.slice(1) : "";
}

/**
 * Drafts without AI: two templates to fill in, built from the vision's
 * first sentence when there is one, plus one shaped by the backlog's most
 * common words. Plain, so the person rewrites them in their own terms.
 */
export function fallbackGoals({ vision, stories }: GoalDraftInput): DraftedGoal[] {
  const clause = visionClause(vision);
  const goals: DraftedGoal[] = [
    {
      statement: cut(
        clause
          ? `Within a year, more of our customers get this from the product: ${clause}.`
          : "Within a year, [who] can [do what] without [today's main obstacle].",
        300
      ),
      why: "Say who gains and what changes for them, so every sprint can show a step towards it.",
      measures: [
        "Share of customers who do it at least once a week",
        "Time it takes them, from start to done",
      ],
    },
    {
      statement: cut(
        clause
          ? `Halve what stops customers from reaching this: ${clause}.`
          : "Halve the time [who] spends on [their slowest step] by [date].",
        300
      ),
      why: "A goal about removing one obstacle keeps the backlog focused on it.",
      measures: [
        "The obstacle measured today, and its target",
        "Support requests about it each month",
      ],
    },
  ];
  const theme = commonTheme(stories);
  if (theme) {
    goals.push({
      statement: cut(`Make ${theme} work so well that customers choose us for it.`, 300),
      why: `Much of the backlog is about ${theme}: a goal around it says why that work matters.`,
      measures: [
        `Customers who use ${theme} each month`,
        `Satisfaction with ${theme} (a quick survey)`,
      ],
    });
  }
  return goals.slice(0, GOAL_DRAFT_MAX);
}

const STOP = new Set(
  "a an and as at be by can for from in into is it of on or our the to with without we they their user users customer customers able add new page story stories".split(
    " "
  )
);

/** The word the story titles use most (4 letters or more, at least twice), or "". */
export function commonTheme(stories: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const title of stories) {
    const seen = new Set<string>();
    for (const w of title.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length < 4 || STOP.has(w) || seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  let best = "";
  let bestN = 1;
  counts.forEach((n, w) => {
    if (n > bestN || (n === bestN && n > 1 && w < best)) {
      best = w;
      bestN = n;
    }
  });
  return bestN >= 2 ? best : "";
}

export const productGoalDraftTask = defineAiTask({
  id: "product-goal.draft",
  toolId: "product-goal",
  tier: "full",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: (i) => ({ goals: fallbackGoals(i) }),
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
