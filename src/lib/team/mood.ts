/**
 * The team's mood over a stretch of days, read from Mood Tracker check-ins:
 * shared by the retro's facts and Sprint Comparison. Pure.
 */

import type { MoodEntry } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { dayOf } from "@/lib/impediments/model";

export interface MoodWindow {
  /** Mean score (1–5) to one decimal; null below MIN_SAMPLE.average check-ins. */
  average: number | null;
  /** Check-ins in the window (placeholders and examples left out). */
  checkIns: number;
  /** Different people who checked in. */
  people: number;
}

/** Mood from the check-ins dated `start` to `end` (YYYY-MM-DD, both included). */
export function moodDuring(
  entries: readonly MoodEntry[] | undefined,
  start: string,
  end: string
): MoodWindow {
  const checkIns = (entries ?? []).filter((m) => {
    if (m.isPlaceholder || isExampleId(m.id)) return false;
    const day = dayOf(m.date);
    return Boolean(day && day >= start && day <= end);
  });
  const average =
    checkIns.length >= MIN_SAMPLE.average
      ? Math.round((checkIns.reduce((sum, m) => sum + m.score, 0) / checkIns.length) * 10) / 10
      : null;
  return {
    average,
    checkIns: checkIns.length,
    people: new Set(checkIns.map((m) => m.memberId)).size,
  };
}
