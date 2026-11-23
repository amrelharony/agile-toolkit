/**
 * Root Cause's AI tasks, the defs (prompts in root-cause.server.ts; pages
 * import `root-cause.lite.ts`, which holds the fallbacks):
 *
 *   root-cause.next_why       the problem and the chain so far → up to 3
 *                             candidate answers to the next "why?"
 *   root-cause.categories     the problem and the fishbone's causes → which
 *                             category each cause belongs under
 *   root-cause.countermeasure the problem, the root cause and the chain →
 *                             up to 3 countermeasures, each with a check
 *   root-cause.loop_links     the problem, the causal loop's things and
 *                             arrows → up to 10 new arrows, each signed,
 *                             with why it may hold
 *
 * Each has a fallback that needs no model: templates built from the last
 * answer (next_why), keyword rules for the six default categories
 * (categories), templates built from the root cause (countermeasure), and
 * a chain of the loop's things with one arrow back (loop_links). The
 * person accepts what fits; nothing is written on its own.
 */

import { z } from "zod";
import { defineAiTask, type SchemaOf } from "../define-task";
import {
  LOOP_LINKS_INPUT_MAX,
  LOOP_LINKS_MAX,
  LOOP_LINK_WHY_MAX,
  ROOT_CAUSE_SUGGESTIONS_MAX,
  categoriesFallback,
  countermeasureFallback,
  loopLinksFallback,
  nextWhyFallback,
} from "./root-cause.lite";

export {
  LOOP_LINKS_INPUT_MAX,
  LOOP_LINKS_MAX,
  LOOP_LINK_WHY_MAX,
  ROOT_CAUSE_SUGGESTIONS_MAX,
  categoriesFallback,
  categoryFor,
  countermeasureFallback,
  fallbackCategoryMoves,
  fallbackCountermeasures,
  fallbackLoopLinks,
  fallbackNextWhys,
  guessPolarity,
  loopLinksFallback,
  nextWhyFallback,
} from "./root-cause.lite";

const Line = (max: number) => z.string().trim().max(max);

/* ── root-cause.next_why ────────────────────────────────────────────── */

const nextWhyInput = z.object({
  problem: Line(1000).min(1),
  whys: z.array(Line(1000)).max(20),
});

const nextWhyOutput = z.object({
  whys: z.array(Line(300).min(1)).min(1).max(ROOT_CAUSE_SUGGESTIONS_MAX),
});

export type NextWhyInput = SchemaOf<typeof nextWhyInput>;
export type NextWhyOutput = SchemaOf<typeof nextWhyOutput>;

export const nextWhyTask = defineAiTask({
  id: "root-cause.next_why",
  toolId: "root-cause",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: nextWhyInput,
  output: nextWhyOutput,
  fallback: nextWhyFallback,
  sample: {
    problem: "Two of the last three releases were rolled back the same day.",
    whys: [
      "A database migration failed in production.",
      "The migration was never run against production-sized data.",
    ],
  },
});

/* ── root-cause.categories ──────────────────────────────────────────── */

const categoriesInput = z.object({
  problem: Line(1000).min(1),
  categories: z.array(Line(60).min(1)).min(1).max(12),
  causes: z
    .array(
      z.object({
        id: Line(64).min(1),
        text: Line(1000).min(1),
        category: Line(60),
      })
    )
    .min(1)
    .max(100),
});

const categoriesOutput = z.object({
  moves: z
    .array(
      z.object({
        causeId: Line(64).min(1),
        category: Line(60).min(1),
      })
    )
    .max(100),
});

export type CategoriesInput = SchemaOf<typeof categoriesInput>;
export type CategoriesOutput = SchemaOf<typeof categoriesOutput>;

export const categoriesTask = defineAiTask({
  id: "root-cause.categories",
  toolId: "root-cause",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: categoriesInput,
  output: categoriesOutput,
  fallback: categoriesFallback,
  sample: {
    problem: "Customers saw checkout errors for two hours before anyone noticed.",
    categories: ["People", "Process", "Tools", "Environment", "Measurement", "Other"],
    causes: [
      { id: "c1", text: "No alert on the checkout error rate", category: "Other" },
      { id: "c2", text: "The on-call engineer was new and not onboarded", category: "Other" },
      { id: "c3", text: "Staging had no payment sandbox", category: "Tools" },
    ],
  },
});

/* ── root-cause.countermeasure ──────────────────────────────────────── */

const countermeasureInput = z.object({
  problem: Line(1000).min(1),
  rootCause: Line(1000).min(1),
  whys: z.array(Line(1000)).max(20),
  causes: z.array(Line(300)).max(20),
});

const countermeasureOutput = z.object({
  countermeasures: z
    .array(
      z.object({
        text: Line(300).min(1),
        check: Line(300).min(1),
      })
    )
    .min(1)
    .max(ROOT_CAUSE_SUGGESTIONS_MAX),
});

export type CountermeasureInput = SchemaOf<typeof countermeasureInput>;
export type CountermeasureOutput = SchemaOf<typeof countermeasureOutput>;

export const countermeasureTask = defineAiTask({
  id: "root-cause.countermeasure",
  toolId: "root-cause",
  tier: "full",
  effort: "high",
  maxTokens: 4096,
  input: countermeasureInput,
  output: countermeasureOutput,
  fallback: countermeasureFallback,
  sample: {
    problem: "Two of the last three releases were rolled back the same day.",
    rootCause: "Migrations are only tested on a small, seeded database.",
    whys: [
      "A database migration failed in production.",
      "The migration was never run against production-sized data.",
      "Migrations are only tested on a small, seeded database.",
    ],
    causes: ["No rehearsal of the release", "Release checklist skipped under time pressure"],
  },
});

/* ── root-cause.loop_links ──────────────────────────────────────────── */

const Polarity = z.enum(["same", "opposite"]);
const L = LOOP_LINKS_INPUT_MAX;

const loopLinksInput = z.object({
  problem: Line(L.problem).min(1),
  nodes: z
    .array(z.object({ id: Line(L.id).min(1), text: Line(L.node).min(1) }))
    .min(2)
    .max(L.nodes),
  links: z.array(z.object({ from: Line(L.id), to: Line(L.id), polarity: Polarity })).max(L.links),
});

const loopLinksOutput = z.object({
  links: z
    .array(
      z.object({
        from: Line(L.id).min(1),
        to: Line(L.id).min(1),
        polarity: Polarity,
        delay: z.boolean().optional(),
        why: Line(LOOP_LINK_WHY_MAX).min(1),
      })
    )
    .max(LOOP_LINKS_MAX),
});

export type LoopLinksInput = SchemaOf<typeof loopLinksInput>;
export type LoopLinksOutput = SchemaOf<typeof loopLinksOutput>;

export const loopLinksTask = defineAiTask({
  id: "root-cause.loop_links",
  toolId: "root-cause",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: loopLinksInput,
  output: loopLinksOutput,
  fallback: loopLinksFallback,
  sample: {
    problem: "Checkout errors noticed late. Customers saw errors for two hours before anyone knew.",
    nodes: [
      { id: "e", text: "Checkout errors customers see" },
      { id: "t", text: "Support tickets" },
      { id: "f", text: "Time spent firefighting" },
      { id: "a", text: "Alerts on checkout" },
    ],
    links: [
      { from: "e", to: "t", polarity: "same" },
      { from: "t", to: "f", polarity: "same" },
    ],
  },
});
