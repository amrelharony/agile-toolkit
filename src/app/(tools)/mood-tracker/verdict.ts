import { fmt } from "@/lib/charts/chart-text";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import type { LowMoodStreak, MoodSummary } from "@/lib/team/mood";

/** "24 Oct" for a YYYY-MM-DD day. */
export function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** "24–26 Oct", or "30 Sept–2 Oct" across months. */
export function streakSpan(s: Pick<LowMoodStreak, "start" | "end">): string {
  if (s.start === s.end) return shortDay(s.start);
  if (s.start.slice(0, 7) === s.end.slice(0, 7)) {
    const [day] = shortDay(s.start).split(" ");
    return `${day}–${shortDay(s.end)}`;
  }
  return `${shortDay(s.start)}–${shortDay(s.end)}`;
}

/**
 * The team's mood in one sentence, over the window shown:
 *
 *   "Team mood has been low for 3 check-in days (2.1 on average, 24–26 Oct):
 *    worth raising at the retro."
 *   "Team mood averaged 3.6 out of 5 over the last 14 days, from 42
 *    check-ins (18 anonymous)."
 */
export function moodVerdict(
  summary: MoodSummary,
  streak: LowMoodStreak | null,
  { days, trend }: { days: number; trend?: "rising" | "falling" | "flat" | null }
): string {
  if (summary.checkIns === 0) {
    return `No check-ins in the last ${days} days: pick a face for each person, or run an anonymous pulse.`;
  }
  if (streak) {
    return `Team mood has been low for ${streak.days} check-in days (${fmt(streak.average)} on average, ${streakSpan(streak)}): worth raising at the retro.`;
  }
  if (summary.average === null) {
    return `Only ${summary.checkIns} ${summary.checkIns === 1 ? "check-in" : "check-ins"} in the last ${days} days: an average needs ${MIN_SAMPLE.average}.`;
  }
  const anon = summary.anonymous ? ` (${summary.anonymous} anonymous)` : "";
  const moving = trend === "rising" ? ", and rising" : trend === "falling" ? ", and falling" : "";
  return `Team mood averaged ${fmt(summary.average)} out of 5 over the last ${days} days, from ${summary.checkIns} check-ins${anon}${moving}.`;
}
