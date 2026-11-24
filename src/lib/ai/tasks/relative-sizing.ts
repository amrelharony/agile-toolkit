/**
 * Relative Sizing's AI tasks, the defs (prompts in relative-sizing.server.ts;
 * pages import `relative-sizing.lite.ts`, which holds the fallbacks):
 *
 *   relative-sizing.discuss  a story the team put far apart, its buckets and
 *                            the room's counts per bucket (totals only) →
 *                            up to 3 questions to talk it through
 *   relative-sizing.split    a story too big for its bucket → up to 4
 *                            smaller stories, and the split pattern used
 *
 * Both fallbacks need no model: questions from the lowest and highest
 * bucket used (discuss), and Backlog Health's split patterns (split). In a
 * live room only the host gets AI, on totals and the host's own story
 * text; nothing reaches the room. The person accepts what fits, with Undo.
 */

import { z } from "zod";
import { defineAiTask, type SchemaOf } from "../define-task";
import {
  RELATIVE_SIZING_AI as CAP,
  SPLIT_PATTERN_IDS,
  fallbackDiscuss,
  fallbackSplit,
} from "./relative-sizing.lite";

export {
  RELATIVE_SIZING_AI,
  SPLIT_PATTERN_IDS,
  fallbackDiscuss,
  fallbackSplit,
} from "./relative-sizing.lite";

const Line = (max: number) => z.string().trim().max(max);

/* ── relative-sizing.discuss ────────────────────────────────────────── */

const discussInput = z.object({
  title: Line(CAP.title).min(1),
  buckets: z.array(Line(CAP.label).min(1)).min(2).max(CAP.buckets),
  counts: z.array(z.number().int().min(0).max(CAP.count)).max(CAP.buckets),
  moves: z.number().int().min(0).max(CAP.moves),
});

const discussOutput = z.object({
  questions: z.array(Line(CAP.title).min(1)).min(1).max(CAP.questionsOut),
});

export type DiscussInput = SchemaOf<typeof discussInput>;
export type DiscussOutput = SchemaOf<typeof discussOutput>;

export const sizingDiscussTask = defineAiTask({
  id: "relative-sizing.discuss",
  toolId: "relative-sizing",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: discussInput,
  output: discussOutput,
  fallback: fallbackDiscuss,
  sample: {
    title: "Pay with a saved card",
    buckets: ["1", "2", "3", "5", "8", "13", "21"],
    counts: [0, 0, 2, 0, 3, 1, 0],
    moves: 4,
  },
});

/* ── relative-sizing.split ──────────────────────────────────────────── */

const splitInput = z.object({
  title: Line(CAP.title).min(1),
  notes: Line(CAP.notes),
  bucket: Line(CAP.label),
});

const splitOutput = z.object({
  titles: z.array(Line(CAP.title).min(1)).min(1).max(CAP.titlesOut),
  pattern: z.enum(SPLIT_PATTERN_IDS).optional(),
});

export type SplitInput = SchemaOf<typeof splitInput>;
export type SplitOutput = SchemaOf<typeof splitOutput>;

export const sizingSplitTask = defineAiTask({
  id: "relative-sizing.split",
  toolId: "relative-sizing",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: splitInput,
  output: splitOutput,
  fallback: fallbackSplit,
  sample: {
    title: "Import bank statements from every bank and currency",
    notes: "Customers ask for CSV and OFX files.",
    bucket: "21",
  },
});
