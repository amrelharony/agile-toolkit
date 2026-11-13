/**
 * The Retro board's AI tasks, the browser-safe half (prompts in retro.server.ts):
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
import { suggestFormat } from "@/lib/retro/suggest";
import { keywordThemes } from "@/app/(tools)/retro/themes";
import { keywordRecurring } from "@/lib/retro/recurring-themes";
import { defineAiTask, type SchemaOf } from "../define-task";

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

/** The facts as lib/retro/suggest reads them (it looks at these fields only). */
function suggestFacts(s: NonNullable<SurpriseInput["sprint"]>) {
  return {
    sprintName: s.name,
    goalOutcome: s.goal === "unknown" ? null : { met: s.goal, decidedAt: "" },
    committed: s.committed,
    completed: s.completed,
    sayDo: s.sayDo === "unknown" ? null : { ratio: 0, pct: 0, grade: s.sayDo, score: 0 },
    mood: { average: s.mood, checkIns: 0, people: 0 },
  };
}

/**
 * Without AI: the format the sprint's facts call for, when it's a
 * candidate, with the reason; else the first candidate, with a line on
 * what its columns ask.
 */
export function fallbackSurprise(input: SurpriseInput): { formatId: string; why: string } {
  const suggestion = input.sprint
    ? suggestFormat(suggestFacts(input.sprint), { ended: input.sprint.ended })
    : null;
  const suggested = suggestion && input.formats.find((f) => f.id === suggestion.formatId);
  if (suggestion && suggested) {
    return {
      formatId: suggested.id,
      why: `${suggestion.reason} ${suggested.name} is built for that.`,
    };
  }
  const first = input.formats[0];
  const columns = first.columns.filter(Boolean).join(", ");
  const sprint = input.sprint?.name ?? "the sprint";
  const avoid = input.recent.length > 0 ? " and isn't one of the last formats you used" : "";
  return {
    formatId: first.id,
    why: `${first.name} gives the team a fresh way to look back on ${sprint}${avoid}${columns ? `: ${columns}` : ""}.`,
  };
}

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

/** Below this many topics, any shared word groups them: there are too few to call a word common. */
const FEW_TOPICS = 5;

/** A shared word as a group's title, in sentence case. */
const titled = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Without AI: topics that share a word (the board's common words), each
 * topic in one group at most. On a small board, where the common words
 * would call any shared word too common, any word two topics share.
 */
export function fallbackTopicGroups(
  topics: readonly { id: string; text: string; votes: number }[]
): { title: string; topicIds: string[] }[] {
  if (topics.length < FEW_TOPICS) {
    return keywordRecurring(
      topics.map((t) => ({ id: t.id, retro: t.id, text: t.text })),
      { minRetros: 2, max: 15 }
    ).map((g) => ({ title: titled(g.name), topicIds: g.cardIds.slice(0, 20) }));
  }
  const cards = topics.map((t) => ({
    id: t.id,
    columnKey: "to-discuss",
    text: t.text,
    votes: t.votes,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
  }));
  return keywordThemes(cards, { maxThemes: 15 })
    .filter((t) => t.cardIds.length >= 2)
    .map((t) => ({ title: titled(t.keyword), topicIds: t.cardIds.slice(0, 20) }));
}

export const groupTopicsTask = defineAiTask({
  id: "retro.group_topics",
  toolId: "retro",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input: groupInput,
  output: groupOutput,
  fallback: ({ topics }) => ({ groups: fallbackTopicGroups(topics) }),
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
