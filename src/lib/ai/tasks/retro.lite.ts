/**
 * The Retro board's AI tasks, the lite half pages import (no zod; the
 * defs, with their schemas, are `retro.ts` and load on first AI use): both
 * fallbacks and one ref per task.
 */

import { lazyAiTask } from "../task-ref";
import { suggestFormat } from "@/lib/retro/suggest";
import { keywordThemes } from "@/app/(tools)/retro/themes";
import { keywordRecurring } from "@/lib/retro/recurring-themes";
import type { GroupTopicsInput, GroupTopicsOutput, SurpriseInput, SurpriseOutput } from "./retro";
export type { GroupTopicsInput, GroupTopicsOutput, SurpriseInput, SurpriseOutput } from "./retro";

/* ── retro.surprise_plan ────────────────────────────────────────────── */

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
export function fallbackSurprise(input: SurpriseInput): SurpriseOutput {
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

export const surprisePlanTask = lazyAiTask<SurpriseInput, SurpriseOutput>(
  { id: "retro.surprise_plan", toolId: "retro", fallback: fallbackSurprise },
  () => import("./retro").then((m) => m.surprisePlanTask)
);

/* ── retro.group_topics ─────────────────────────────────────────────── */

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

/** The group task's answer without AI. */
export const groupTopicsFallback = ({ topics }: GroupTopicsInput): GroupTopicsOutput => ({
  groups: fallbackTopicGroups(topics),
});

export const groupTopicsTask = lazyAiTask<GroupTopicsInput, GroupTopicsOutput>(
  { id: "retro.group_topics", toolId: "retro", fallback: groupTopicsFallback },
  () => import("./retro").then((m) => m.groupTopicsTask)
);
