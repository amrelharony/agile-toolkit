import type { MoodEntry, MoodPulse } from "@/lib/stores/workspace-types";
import { dayOf } from "@/lib/impediments/model";
import {
  MOOD_SCORES,
  dailyMood,
  teamLevelDays,
  type MoodMode,
  type MoodSummary,
} from "@/lib/team/mood";

interface PromptEntry {
  memberId: string;
  date: string;
  score: number;
  note?: string;
}

const whole = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0);

/**
 * What the AI prompt is given, so it quotes the page's numbers: the
 * headline's own average (`summary`, the window's, from MIN_SAMPLE.average
 * check-ins), and the check-ins that average counts, by day: named ones and
 * pulse answers alike, in either mode. In the anonymous mode they carry no
 * name or note, and only days with enough check-ins to be team level are
 * listed. Below the minimum there is no average to interpret, so no prompt
 * (the page shows "—").
 */
export function moodPromptData(
  named: readonly MoodEntry[],
  pulses: readonly MoodPulse[],
  days: readonly string[],
  summary: Pick<MoodSummary, "average">,
  mode: MoodMode
): { entries: PromptEntry[]; days: string[]; overallAvg: number } {
  if (summary.average === null || days.length === 0) {
    return { entries: [], days: [...days], overallAvg: 0 };
  }
  const first = days[0];
  const last = days[days.length - 1];
  const teamDays =
    mode === "anonymous"
      ? new Set(teamLevelDays(dailyMood(named, pulses, days)).map((d) => d.date))
      : null;
  const keep = (day: string | null): day is string =>
    !!day && day >= first && day <= last && (!teamDays || teamDays.has(day));
  const fromNamed = named.flatMap((e): PromptEntry[] => {
    const day = dayOf(e.date);
    if (!keep(day)) return [];
    return mode === "named"
      ? [{ memberId: e.memberId, date: day, score: e.score, ...(e.note ? { note: e.note } : {}) }]
      : [{ memberId: "team", date: day, score: e.score }];
  });
  const fromPulses = pulses.flatMap((p): PromptEntry[] => {
    const day = dayOf(p.date);
    if (!keep(day)) return [];
    return MOOD_SCORES.flatMap((s) =>
      Array.from({ length: whole(p.counts[s]) }, () => ({ memberId: "team", date: day, score: s }))
    );
  });
  return { entries: [...fromNamed, ...fromPulses], days: [...days], overallAvg: summary.average };
}
