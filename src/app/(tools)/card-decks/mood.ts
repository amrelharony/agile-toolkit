/**
 * The team's mood as Card Decks' "a card for the mood" reads it: the team's
 * average over the last two weeks of Mood Tracker check-ins (named and
 * anonymous alike, never a person's own), which way it moved, and how many
 * days in a row it has been low. All of it from lib/team/mood, so it quotes
 * the same numbers as the Mood Tracker. Pure.
 */

import type { MoodEntry, MoodPulse } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/impediments/model";
import {
  MOOD_LABELS,
  MOOD_WINDOW_DAYS,
  isMoodScore,
  lowMoodStreak,
  moodDuring,
} from "@/lib/team/mood";
import type { CardForMoodInput, MoodTrend } from "@/lib/ai/tasks/card-decks";

export type TeamMood = CardForMoodInput["mood"];

/** How far the second week's average must move from the first's to count as a trend. */
const TREND_STEP = 0.3;

export function teamMood(
  entries: readonly MoodEntry[] | undefined,
  pulses: readonly MoodPulse[] | undefined,
  today: string
): TeamMood {
  const start = addDays(today, -(MOOD_WINDOW_DAYS - 1));
  const half = addDays(today, -Math.floor(MOOD_WINDOW_DAYS / 2));
  const all = moodDuring(entries, start, today, pulses);
  const before = moodDuring(entries, start, addDays(half, -1), pulses).average;
  const after = moodDuring(entries, half, today, pulses).average;
  let trend: MoodTrend = "unknown";
  if (before !== null && after !== null) {
    trend =
      after - before >= TREND_STEP ? "rising" : before - after >= TREND_STEP ? "falling" : "steady";
  }
  const streak = lowMoodStreak(entries, pulses, today);
  return {
    average: all.average,
    checkIns: Math.min(all.checkIns, 100_000),
    trend,
    lowDays: Math.min(streak?.days ?? 0, 366),
  };
}

/** One line on the mood, for under the button. */
export function moodLine(mood: TeamMood): string {
  if (mood.average === null) {
    return mood.lowDays >= 3
      ? `The team's mood has been low for ${mood.lowDays} days in a row.`
      : `Not enough Mood Tracker check-ins in the last ${MOOD_WINDOW_DAYS} days to go on: Amr picks a light card.`;
  }
  const rounded = Math.round(mood.average);
  const label = isMoodScore(rounded) ? MOOD_LABELS[rounded].toLowerCase() : "";
  const trend = mood.trend === "rising" ? ", rising" : mood.trend === "falling" ? ", falling" : "";
  return `Team mood over the last ${MOOD_WINDOW_DAYS} days: ${mood.average} of 5${
    label ? ` (${label})` : ""
  }${trend}, from ${mood.checkIns} check-ins.`;
}
