/**
 * Root Cause's AI tasks, the lite half pages import (no zod; the defs, with
 * their schemas, are `root-cause.ts` and load on first AI use): the four
 * fallbacks, with their templates and keyword rules, and one ref per task.
 */

import { lazyAiTask } from "../task-ref";
import { TOOL_AI_BODY_BUDGET } from "../contract";
import { LOOP_LENGTH_MAX } from "@/lib/root-cause/loops";
import { jsonBytes } from "@/lib/utils/json-bytes";
import type {
  CategoriesInput,
  CategoriesOutput,
  CountermeasureInput,
  CountermeasureOutput,
  LoopLinksInput,
  LoopLinksOutput,
  NextWhyInput,
  NextWhyOutput,
} from "./root-cause";
export type {
  CategoriesInput,
  CategoriesOutput,
  CountermeasureInput,
  CountermeasureOutput,
  LoopLinksInput,
  LoopLinksOutput,
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

/**
 * The next-why input, trimmed until its request (`{task, input}`) fits
 * `budget` bytes: at its caps (20 whys of 1,000 characters) it can pass the
 * body budget. The oldest whys go first; the problem and the last why,
 * which the next one answers, always stay. The input as it is when it
 * already fits.
 */
export function fitNextWhyInput(
  input: NextWhyInput,
  budget: number = TOOL_AI_BODY_BUDGET
): NextWhyInput {
  const size = (x: NextWhyInput) => jsonBytes({ task: "root-cause.next_why", input: x });
  let next = input;
  while (next.whys.length > 1 && size(next) > budget) {
    next = { ...next, whys: next.whys.slice(1) };
  }
  return next;
}

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

/**
 * The categories input, trimmed until its request fits `budget` bytes: at
 * its caps (100 causes of 1,000 characters) it passes the body budget many
 * times over. Causes go from the end of the board, keeping at least one,
 * so the moves cover the causes sent. The input as it is when it fits.
 */
export function fitCategoriesInput(
  input: CategoriesInput,
  budget: number = TOOL_AI_BODY_BUDGET
): CategoriesInput {
  let bytes = jsonBytes({ task: "root-cause.categories", input });
  let keep = input.causes.length;
  // Measured once, then each cause taken off with the comma before it.
  while (keep > 1 && bytes > budget) {
    bytes -= jsonBytes(input.causes[keep - 1]) + 1;
    keep--;
  }
  return keep === input.causes.length ? input : { ...input, causes: input.causes.slice(0, keep) };
}

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

/* ── root-cause.loop_links ──────────────────────────────────────────── */

/** The loop-links task's input caps (the def's schema holds the same numbers). */
export const LOOP_LINKS_INPUT_MAX = {
  problem: 1000,
  id: 64,
  node: 120,
  nodes: 30,
  links: 60,
} as const;

/** Arrows one ask suggests at most. */
export const LOOP_LINKS_MAX = 10;
/** The most words of each suggested arrow's why. */
export const LOOP_LINK_WHY_MAX = 200;

/** Things the fallback chains, in the loop's list order. */
const LOOP_CHAIN_MAX = 10;

/** Words that say a thing goes down: on exactly one end, the arrow reads "opposite". */
const GOING_DOWN = /\b(less|fewer|lack\w*|no|low\w*|slow\w*|missing)\b/i;

/** "same", unless exactly one of the two things says it goes down. */
export function guessPolarity(fromText: string, toText: string): "same" | "opposite" {
  return GOING_DOWN.test(fromText) !== GOING_DOWN.test(toText) ? "opposite" : "same";
}

type LoopNodeIn = LoopLinksInput["nodes"][number];
type LoopLinkOut = LoopLinksOutput["links"][number];

/**
 * Whether the arrows lead from `from` to `to` through at most
 * LOOP_LENGTH_MAX things, both ends counted: then an arrow from `to` back
 * to `from` closes a loop findLoops follows.
 */
function leadsTo(
  arrows: readonly { from: string; to: string }[],
  from: string,
  to: string
): boolean {
  const next = new Map<string, string[]>();
  for (const l of arrows) {
    if (l.from !== l.to) next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
  }
  const seen = new Set([from]);
  let frontier = [from];
  for (let things = 1; things < LOOP_LENGTH_MAX && frontier.length > 0; things++) {
    const reached: string[] = [];
    for (const at of frontier) {
      for (const n of next.get(at) ?? []) {
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        reached.push(n);
      }
    }
    frontier = reached;
  }
  return false;
}

/**
 * Arrows to check, without AI: the first ten things chained in list order,
 * one arrow for each neighbouring pair not linked yet (either way), each
 * signed by its words (`guessPolarity`) and asking the team to check the
 * sign; then one arrow between the last of them and the first, unless
 * those two are linked already. It runs back from the last to the first
 * when the arrows drawn and suggested lead from the first to the last, so
 * it closes a loop of at most ten; from the first to the last when they
 * lead the other way (a chain drawn last to first); and when neither, back
 * with a plain "check the sign" why, never claiming a loop it doesn't
 * close. At most ten arrows, inside findLoops' length limit. A thing the
 * schema refuses (no id, an id over 64 characters, no words) is left out,
 * so the answer always fits the output schema.
 */
export function fallbackLoopLinks(
  nodes: readonly LoopNodeIn[],
  links: readonly { from: string; to: string }[]
): LoopLinkOut[] {
  const usable = nodes
    .filter((n) => n.id.trim() && n.id.length <= LOOP_LINKS_INPUT_MAX.id && n.text.trim())
    .slice(0, LOOP_CHAIN_MAX);
  const linked = (a: string, b: string) =>
    links.some((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
  const checkSign = (a: LoopNodeIn, b: LoopNodeIn): LoopLinkOut => {
    const polarity = guessPolarity(a.text, b.text);
    return {
      from: a.id,
      to: b.id,
      polarity,
      why: `Check the sign: does ${quoted(b.text, 70)} go ${polarity === "same" ? "up" : "down"} when ${quoted(a.text, 70)} goes up?`,
    };
  };
  const closing = (a: LoopNodeIn, b: LoopNodeIn): LoopLinkOut => ({
    from: a.id,
    to: b.id,
    polarity: guessPolarity(a.text, b.text),
    why: "If this is true, it closes a loop: check it.",
  });
  const out: LoopLinkOut[] = [];
  for (let i = 0; i + 1 < usable.length; i++) {
    const [a, b] = [usable[i], usable[i + 1]];
    if (!linked(a.id, b.id)) out.push(checkSign(a, b));
  }
  if (usable.length >= 2) {
    const [first, last] = [usable[0], usable[usable.length - 1]];
    if (!linked(last.id, first.id)) {
      const arrows = [...links, ...out];
      if (leadsTo(arrows, first.id, last.id)) out.push(closing(last, first));
      else if (leadsTo(arrows, last.id, first.id)) out.push(closing(first, last));
      else out.push(checkSign(last, first));
    }
  }
  return out.slice(0, LOOP_LINKS_MAX);
}

/** The loop-links task's answer without AI. */
export const loopLinksFallback = ({ nodes, links }: LoopLinksInput): LoopLinksOutput => ({
  links: fallbackLoopLinks(nodes, links),
});

export const loopLinksTask = lazyAiTask<LoopLinksInput, LoopLinksOutput>(
  { id: "root-cause.loop_links", toolId: "root-cause", fallback: loopLinksFallback },
  () => import("./root-cause").then((m) => m.loopLinksTask)
);
