/**
 * Root Cause's AI tasks, the browser-safe half (prompts in root-cause.server.ts):
 *
 *   root-cause.next_why       the problem and the chain so far → up to 3
 *                             candidate answers to the next "why?"
 *   root-cause.categories     the problem and the fishbone's causes → which
 *                             category each cause belongs under
 *   root-cause.countermeasure the problem, the root cause and the chain →
 *                             up to 3 countermeasures, each with a check
 *
 * Each has a fallback that needs no model: templates built from the last
 * answer (next_why), keyword rules for the six default categories
 * (categories), and templates built from the root cause (countermeasure).
 * The person accepts what fits; nothing is written on its own.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";

/** Candidates one ask returns. */
export const ROOT_CAUSE_SUGGESTIONS_MAX = 3;

const Line = (max: number) => z.string().trim().max(max);

/* ── root-cause.next_why ────────────────────────────────────────────── */

const nextWhyInput = z.object({
  problem: Line(1000).min(1),
  whys: z.array(Line(1000)).max(20),
});

const nextWhyOutput = z.object({
  whys: z.array(Line(300).min(1)).min(1).max(ROOT_CAUSE_SUGGESTIONS_MAX),
});

/** "“Deploys failed”" for a template, cut to fit. */
function quoted(text: string, max = 120): string {
  const t = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/, "");
  return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`;
}

/**
 * Three candidate answers to the next "why?", built from the last answer
 * (or the problem, before the first): a check that didn't catch it, the way
 * of working that let it through, and nobody owning it. Generic on purpose:
 * they are prompts the team edits, and each points at the process rather
 * than a person.
 */
export function fallbackNextWhys(problem: string, whys: readonly string[]): string[] {
  const last = [...whys].reverse().find((w) => w.trim()) ?? problem;
  const it = quoted(last);
  return [
    `No check caught ${it} before it went further.`,
    `The way we plan and hand over work made ${it} easy to miss.`,
    `Nobody clearly owned ${it}, so it waited.`,
  ];
}

export const nextWhyTask = defineAiTask({
  id: "root-cause.next_why",
  toolId: "root-cause",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: nextWhyInput,
  output: nextWhyOutput,
  fallback: ({ problem, whys }) => ({ whys: fallbackNextWhys(problem, whys) }),
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

/**
 * Words that place a cause under one of the six default categories, first
 * match wins (in this order). Whole-word stems, lower case.
 */
const CATEGORY_RULES: readonly { category: string; words: RegExp }[] = [
  {
    category: "Measurement",
    words:
      /\b(metric|monitor|alert|dashboard|measur|log|logging|observab|report|data|kpi|sla|trac(k|ing))/,
  },
  {
    category: "Tools",
    words:
      /\b(tool|ci\b|pipeline|build|script|jira|server|library|framework|test suite|automation|deploy(ment)? tool|ide|laptop|software|bug)/,
  },
  {
    category: "Environment",
    words:
      /\b(environment|staging|prod(uction)?|network|office|remote|time ?zone|outage|infra|cloud|vendor|weather|noise|holiday)/,
  },
  {
    category: "People",
    words:
      /\b(skill|training|onboard|knowledge|new joiner|staff|hire|hiring|people|person|tired|overload|burnout|availab|sick|leave|holiday cover)/,
  },
  {
    category: "Process",
    words:
      /\b(process|review|hand-?off|handover|approval|step|policy|plan|estimate|meeting|refinement|definition of done|checklist|priorit|scope|requirement|communicat)/,
  },
];

/** The category a cause's words point to, or null when none does. */
export function categoryFor(text: string): string | null {
  const t = text.toLowerCase();
  return CATEGORY_RULES.find((r) => r.words.test(t))?.category ?? null;
}

/**
 * Moves without AI: each cause whose words point to one of the board's
 * categories (by the keyword rules above) and that sits under another one.
 * A rule's category the board doesn't have is skipped.
 */
export function fallbackCategoryMoves(
  categories: readonly string[],
  causes: readonly { id: string; text: string; category: string }[]
): { causeId: string; category: string }[] {
  const byKey = new Map(categories.map((c) => [c.trim().toLowerCase(), c]));
  const out: { causeId: string; category: string }[] = [];
  for (const cause of causes) {
    const pick = categoryFor(cause.text);
    const target = pick ? byKey.get(pick.toLowerCase()) : undefined;
    if (!target || target.toLowerCase() === cause.category.trim().toLowerCase()) continue;
    out.push({ causeId: cause.id, category: target });
  }
  return out.slice(0, 100);
}

export const categoriesTask = defineAiTask({
  id: "root-cause.categories",
  toolId: "root-cause",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: categoriesInput,
  output: categoriesOutput,
  fallback: ({ categories, causes }) => ({ moves: fallbackCategoryMoves(categories, causes) }),
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

/**
 * Three countermeasures without AI, built from the root cause: stop it at
 * the source, catch it earlier, and make someone own it, each with a check
 * the team can look at in a sprint or two.
 */
export function fallbackCountermeasures(rootCause: string): { text: string; check: string }[] {
  const it = quoted(rootCause);
  return [
    {
      text: `Change the step that lets ${it} happen, and write the new way into the Definition of Done.`,
      check: "At the next two retros, ask whether it happened again.",
    },
    {
      text: `Add a check that catches ${it} before work moves on.`,
      check: "Count how often the check catches it over the next sprint.",
    },
    {
      text: `Name one owner for ${it} and review it at each Sprint Review.`,
      check: "The owner reports at the next review whether it came back.",
    },
  ];
}

export const countermeasureTask = defineAiTask({
  id: "root-cause.countermeasure",
  toolId: "root-cause",
  tier: "full",
  effort: "high",
  maxTokens: 4096,
  input: countermeasureInput,
  output: countermeasureOutput,
  fallback: ({ rootCause }) => ({ countermeasures: fallbackCountermeasures(rootCause) }),
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
