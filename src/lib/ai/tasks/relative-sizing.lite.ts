/**
 * Relative Sizing's AI tasks, the lite half pages import (no zod; the defs,
 * with their schemas, are `relative-sizing.ts` and load on first AI use):
 * the caps, the two fallbacks and one ref per task.
 */

import { lazyAiTask } from "../task-ref";
import { splitPatternsFor, splitTitles } from "@/lib/backlog/health";
import type { DiscussInput, DiscussOutput, SplitInput, SplitOutput } from "./relative-sizing";
export type { DiscussInput, DiscussOutput, SplitInput, SplitOutput } from "./relative-sizing";

/** The caps both halves share. */
export const RELATIVE_SIZING_AI = {
  /** A story's title, in and out. */
  title: 200,
  /** A bucket's label. */
  label: 8,
  /** Buckets on a board. */
  buckets: 11,
  /** People counted on one bucket. */
  count: 999,
  /** Moves a card can show. */
  moves: 99,
  /** A story's notes sent to split it. */
  notes: 600,
  /** Questions one ask returns. */
  questionsOut: 3,
  /** Smaller stories one ask returns. */
  titlesOut: 4,
} as const;

/** The split patterns a split can name (Refinement's five). */
export const SPLIT_PATTERN_IDS = ["spike", "path", "interface", "data", "rules"] as const;

/* ── relative-sizing.discuss ────────────────────────────────────────── */

/**
 * Questions for a story the team put far apart, without AI: from the
 * lowest and the highest bucket anyone used (the board's ends when the
 * room's counts are empty), in our words.
 */
export function fallbackDiscuss(input: DiscussInput): DiscussOutput {
  if (!input.title.trim()) throw new Error("Name the story first.");
  if (input.buckets.length < 2) throw new Error("A board needs two buckets.");
  const used = input.buckets.filter((_, i) => (input.counts[i] ?? 0) > 0);
  let low = used[0] ?? input.buckets[0];
  let high = used[used.length - 1] ?? input.buckets[input.buckets.length - 1];
  if (low === high) {
    const at = input.buckets.indexOf(low);
    low = input.buckets[Math.max(0, at - 1)];
    high = input.buckets[Math.min(input.buckets.length - 1, at + 1)];
    if (low === high) high = input.buckets[input.buckets.length - 1];
  }
  return {
    questions: [
      `What would make it a ${low}?`,
      `What do the ${high}s see that the ${low}s don't?`,
      `Could part of it be a ${low} on its own?`,
    ],
  };
}

export const sizingDiscussTask = lazyAiTask<DiscussInput, DiscussOutput>(
  { id: "relative-sizing.discuss", toolId: "relative-sizing", fallback: fallbackDiscuss },
  () => import("./relative-sizing").then((m) => m.sizingDiscussTask)
);

/* ── relative-sizing.split ──────────────────────────────────────────── */

/**
 * Smaller stories without AI: the two split patterns that suit the title
 * (Backlog Health's rules: by its words, else Path and Spike), two
 * stories each.
 */
export function fallbackSplit(input: SplitInput): SplitOutput {
  if (!input.title.trim()) throw new Error("Name the story first.");
  const patterns = splitPatternsFor(input.title);
  const titles = patterns
    .flatMap((p) => splitTitles(input.title, p.id))
    .slice(0, RELATIVE_SIZING_AI.titlesOut);
  return { titles, pattern: patterns[0].id };
}

export const sizingSplitTask = lazyAiTask<SplitInput, SplitOutput>(
  { id: "relative-sizing.split", toolId: "relative-sizing", fallback: fallbackSplit },
  () => import("./relative-sizing").then((m) => m.sizingSplitTask)
);
