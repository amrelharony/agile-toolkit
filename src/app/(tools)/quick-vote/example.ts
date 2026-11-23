/**
 * Quick Vote's example: a week of meetings' saved rounds (a ROTI, a dot
 * vote on retro topics, a guess with its real answer, a fist of five) and
 * one saved format. A read-only preview: it never reaches the store.
 */

import { exampleId } from "@/lib/utils/example-id";
import { draftFromPreset } from "@/lib/quick-vote/draft";
import { presetById } from "@/lib/quick-vote/presets";
import type { SavedResult } from "@/lib/quick-vote/results";
import type { CustomPreset } from "@/lib/quick-vote/state";

export interface QuickVoteExample {
  results: SavedResult[];
  customPresets: CustomPreset[];
}

/** An ISO time `daysAgo` days before `now`, at 10:00. */
function day(now: Date, daysAgo: number, hour = 10): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function buildExample(now: Date = new Date()): QuickVoteExample {
  const roti = presetById("roti")!;
  const fist = presetById("fist-of-five")!;
  const results: SavedResult[] = [
    {
      id: exampleId("qv-fist"),
      presetId: "fist-of-five",
      savedAt: day(now, 0, 11),
      result: {
        roundId: exampleId("round-fist"),
        tool: "quick-vote",
        questionnaireId: "qv:fist-of-five",
        title: "How much do you support moving the demo to Thursdays?",
        scale: { id: "qv:scale", points: fist.points!.map((p) => ({ ...p })) },
        closedAt: day(now, 0, 11),
        minN: 3,
        ballots: 6,
        source: "live",
        questions: [
          {
            id: "q1",
            text: "How much do you support moving the demo to Thursdays?",
            responses: 6,
            distribution: [0, 0, 0, 2, 3, 1],
          },
        ],
      },
    },
    {
      id: exampleId("qv-guess"),
      presetId: "guess-number",
      savedAt: day(now, 1),
      realAnswer: 11,
      result: {
        kind: "number",
        roundId: exampleId("round-guess"),
        tool: "quick-vote",
        sheetId: "qv:guess-number",
        title: "How many days will the payments migration take?",
        min: 0,
        max: 100,
        decimals: 0,
        unit: "days",
        closedAt: day(now, 1),
        minN: 3,
        ballots: 6,
        source: "live",
        median: 8,
        spread: { min: 3, q1: 5, q3: 12, max: 20, histogram: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0] },
      },
    },
    {
      id: exampleId("qv-dots"),
      presetId: "dots",
      savedAt: day(now, 3),
      result: {
        kind: "choice",
        roundId: exampleId("round-dots"),
        tool: "quick-vote",
        sheetId: "qv:dots",
        title: "Which retro topics should we talk about first?",
        mode: "dots",
        limit: 3,
        closedAt: day(now, 3),
        minN: 3,
        ballots: 6,
        source: "live",
        options: [
          { id: "o1", text: "Flaky end-to-end tests", total: 7, backers: 5 },
          { id: "o2", text: "On-call handover", total: 5, backers: 4 },
          { id: "o3", text: "Release notes nobody reads", total: 4, backers: 3 },
          { id: "o4", text: "Planning prep", total: 2, backers: 2 },
        ],
      },
    },
    {
      id: exampleId("qv-roti"),
      presetId: "roti",
      savedAt: day(now, 4, 16),
      result: {
        roundId: exampleId("round-roti"),
        tool: "quick-vote",
        questionnaireId: "qv:roti",
        title: "How much was this Sprint Review worth the time you gave it?",
        scale: { id: "qv:scale", points: roti.points!.map((p) => ({ ...p })) },
        closedAt: day(now, 4, 16),
        minN: 3,
        ballots: 7,
        source: "facilitator",
        questions: [
          {
            id: "q1",
            text: "How much was this Sprint Review worth the time you gave it?",
            responses: 7,
            distribution: [0, 1, 2, 3, 1],
          },
        ],
      },
    },
  ];
  const customPresets: CustomPreset[] = [
    {
      id: exampleId("qv-preset-review"),
      name: "Sprint Review ROTI",
      createdAt: day(now, 10),
      draft: {
        ...draftFromPreset(roti),
        customId: exampleId("qv-preset-review"),
        question: "How much was this Sprint Review worth the time you gave it?",
      },
    },
  ];
  return { results, customPresets };
}
