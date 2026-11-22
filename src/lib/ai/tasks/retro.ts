/**
 * The Retro board's AI tasks, the defs (prompts in retro.server.ts; pages
 * import `retro.lite.ts`, which holds the fallbacks):
 *
 *   retro.surprise_plan  the sprint's facts and the formats "Surprise me"
 *                        may pick → the one that fits this sprint, and why,
 *                        in a short paragraph
 *   retro.group_topics   Lean Coffee topic cards → groups of duplicates and
 *                        near-duplicates the host may merge
 *
 * Fallbacks: the format the facts call for (lib/retro/suggest) with a
 * template sentence, else the first candidate; and the board's common words
 * (retro/themes) as groups.
 */

import { z } from "zod";
import { defineAiTask, type SchemaOf } from "../define-task";
import { fallbackSurprise, groupTopicsFallback } from "./retro.lite";

export { fallbackSurprise, fallbackTopicGroups, groupTopicsFallback } from "./retro.lite";

const Line = (max: number) => z.string().trim().max(max);

/* ── retro.surprise_plan ────────────────────────────────────────────── */

const sprintFacts = z.object({
  name: Line(120).min(1),
  /** Whether the sprint goal was met, from Sprint Goal. */
  goal: z.enum(["met", "partly", "not-met", "unknown"]),
  committed: z.number().min(0).max(100000),
  completed: z.number().min(0).max(100000),
  sayDo: z.enum(["met", "close", "missed", "over", "unknown"]),
  /** Mean mood, 1–5; null with too few check-ins. */
  mood: z.number().min(1).max(5).nullable(),
  /** The sprint is over (its open work is unfinished, not still to do). */
  ended: z.boolean(),
  /** The facts the board opens with, as lines. */
  facts: z.array(Line(300)).max(12),
});

const surpriseInput = z.object({
  sprint: sprintFacts.nullable(),
  formats: z
    .array(
      z.object({
        id: Line(64).min(1),
        name: Line(120).min(1),
        description: Line(300),
        columns: z.array(Line(60)).max(12),
      })
    )
    .min(1)
    .max(30),
  /** The formats of the latest retros, which the candidates leave out. */
  recent: z.array(Line(120)).max(3),
});

const surpriseOutput = z.object({
  formatId: Line(64).min(1),
  why: Line(600).min(1),
});

export type SurpriseInput = SchemaOf<typeof surpriseInput>;
export type SurpriseOutput = SchemaOf<typeof surpriseOutput>;

export const surprisePlanTask = defineAiTask({
  id: "retro.surprise_plan",
  toolId: "retro",
  tier: "flash",
  effort: "low",
  maxTokens: 2048,
  input: surpriseInput,
  output: surpriseOutput,
  fallback: fallbackSurprise,
  sample: {
    sprint: {
      name: "Sprint 14",
      goal: "partly",
      committed: 34,
      completed: 26,
      sayDo: "close",
      mood: 3.2,
      ended: true,
      facts: [
        "Sprint goal: partly met.",
        "Say/do: 26 of 34 points (76%).",
        "3 impediments raised, 1 still open.",
      ],
    },
    formats: [
      {
        id: "sailboat",
        name: "Sailboat",
        description: "Wind, anchors, rocks and the island.",
        columns: ["Anchor", "Wind", "Rocks", "Island"],
      },
      {
        id: "4ls",
        name: "4Ls",
        description: "Liked, learned, lacked, longed for.",
        columns: ["Liked", "Learned", "Lacked", "Longed For"],
      },
    ],
    recent: ["Start / Stop / Continue"],
  },
});

/* ── retro.group_topics ─────────────────────────────────────────────── */

const groupInput = z.object({
  topics: z
    .array(
      z.object({
        id: Line(64).min(1),
        text: Line(500).min(1),
        votes: z.number().int().min(0).max(999),
      })
    )
    .min(2)
    .max(100),
});

const groupOutput = z.object({
  groups: z
    .array(
      z.object({
        title: Line(80).min(1),
        topicIds: z.array(Line(64).min(1)).min(2).max(20),
      })
    )
    .max(15),
});

export type GroupTopicsInput = SchemaOf<typeof groupInput>;
export type GroupTopicsOutput = SchemaOf<typeof groupOutput>;

export const groupTopicsTask = defineAiTask({
  id: "retro.group_topics",
  toolId: "retro",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: groupInput,
  output: groupOutput,
  fallback: groupTopicsFallback,
  sample: {
    topics: [
      { id: "t1", text: "Our standups run too long", votes: 3 },
      { id: "t2", text: "Standups overrun every day", votes: 1 },
      { id: "t3", text: "Who owns the release checklist?", votes: 2 },
      { id: "t4", text: "Release checklist is out of date", votes: 0 },
      { id: "t5", text: "Lunch and learn ideas", votes: 1 },
    ],
  },
});
