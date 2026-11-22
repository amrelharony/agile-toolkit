/**
 * Root Cause's AI tasks, the lite half pages import (no zod; the defs, with
 * their schemas, are `root-cause.ts` and load on first AI use): the three
 * fallbacks, with their templates and keyword rules, and one ref per task.
 */

import { lazyAiTask } from "../task-ref";
import type {
  CategoriesInput,
  CategoriesOutput,
  CountermeasureInput,
  CountermeasureOutput,
  NextWhyInput,
  NextWhyOutput,
} from "./root-cause";
export type {
  CategoriesInput,
  CategoriesOutput,
  CountermeasureInput,
  CountermeasureOutput,
  NextWhyInput,
  NextWhyOutput,
} from "./root-cause";

/** Candidates one ask returns. */
export const ROOT_CAUSE_SUGGESTIONS_MAX = 3;

/** "“Deploys failed”" for a template, cut to fit. */
function quoted(text: string, max = 120): string {
  const t = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!]+$/, "");
  return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`;
}

/** The first sentence: the problem's title, when the page sends the title and the fact. */
function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.?!])\s+/)[0] ?? text;
}

/* ── root-cause.next_why ────────────────────────────────────────────── */

/**
 * Three candidate answers to the next "why?", built from the last answer
 * (or the problem's first sentence, its title, before the first): a check
 * that didn't catch it, the way of working that let it through, and nobody
 * owning it. Generic on purpose: they are prompts the team edits, and each
 * points at the process rather than a person.
 */
export function fallbackNextWhys(problem: string, whys: readonly string[]): string[] {
  const last = [...whys].reverse().find((w) => w.trim()) ?? firstSentence(problem);
  const it = quoted(last);
  return [
    `No check caught ${it} before it went further.`,
    `The way we plan and hand over work made ${it} easy to miss.`,
    `Nobody clearly owned ${it}, so it waited.`,
  ];
}

/** The next-why task's answer without AI. */
export const nextWhyFallback = ({ problem, whys }: NextWhyInput): NextWhyOutput => ({
  whys: fallbackNextWhys(problem, whys),
});

export const nextWhyTask = lazyAiTask<NextWhyInput, NextWhyOutput>(
  { id: "root-cause.next_why", toolId: "root-cause", fallback: nextWhyFallback },
  () => import("./root-cause").then((m) => m.nextWhyTask)
);

/* ── root-cause.categories ──────────────────────────────────────────── */

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

/** The categories task's answer without AI. */
export const categoriesFallback = ({ categories, causes }: CategoriesInput): CategoriesOutput => ({
  moves: fallbackCategoryMoves(categories, causes),
});

export const categoriesTask = lazyAiTask<CategoriesInput, CategoriesOutput>(
  { id: "root-cause.categories", toolId: "root-cause", fallback: categoriesFallback },
  () => import("./root-cause").then((m) => m.categoriesTask)
);

/* ── root-cause.countermeasure ──────────────────────────────────────── */

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

/** The countermeasure task's answer without AI. */
export const countermeasureFallback = ({
  rootCause,
}: CountermeasureInput): CountermeasureOutput => ({
  countermeasures: fallbackCountermeasures(rootCause),
});

export const countermeasureTask = lazyAiTask<CountermeasureInput, CountermeasureOutput>(
  { id: "root-cause.countermeasure", toolId: "root-cause", fallback: countermeasureFallback },
  () => import("./root-cause").then((m) => m.countermeasureTask)
);
