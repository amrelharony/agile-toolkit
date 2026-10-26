import type { DailyMood, LowMoodStreak, MoodMode, MoodSummary } from "@/lib/team/mood";
import { MOOD_LABELS, MOOD_SCORES } from "@/lib/team/mood";
import { streakSpan } from "./verdict";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const num = (n: number | null) => (n === null ? "—" : String(Math.round(n * 10) / 10));

/**
 * Team mood as Markdown, for the team channel or a retro page: the
 * verdict, the window's average and faces, the low-mood streak, and the
 * team's average per day. Team level only, in either mode: no names, no
 * notes.
 */
export function toMarkdown({
  summary,
  daily,
  streak,
  mode,
  days,
  verdict,
  now = new Date(),
}: {
  summary: MoodSummary;
  daily: readonly DailyMood[];
  streak: LowMoodStreak | null;
  mode: MoodMode;
  days: number;
  verdict?: string;
  now?: Date;
}): string {
  const title = `# Team Mood — ${mdDate(now)}`;
  if (summary.checkIns === 0) return `${title}\n\nNo check-ins in the last ${days} days.\n`;
  const lines = [title, ""];
  if (verdict) lines.push(verdict, "");
  lines.push(
    `**Average:** ${num(summary.average)} out of 5 over the last ${days} days (${summary.checkIns} check-ins${
      summary.anonymous ? `, ${summary.anonymous} of them anonymous` : ""
    }; ${mode === "anonymous" ? "the team checks in anonymously" : "people check in by name"}).`,
    "",
    "| Face | Check-ins |",
    "|---|---:|",
    ...MOOD_SCORES.map((s) => `| ${s} ${MOOD_LABELS[s]} | ${summary.distribution[s]} |`)
  );
  if (streak) {
    lines.push(
      "",
      `**Low-mood streak:** ${streak.days} check-in days at ${num(streak.average)} on average (${streakSpan(streak)}).`
    );
  }
  const logged = daily.filter((d) => d.n > 0);
  if (logged.length > 0) {
    lines.push(
      "",
      "## By day",
      "",
      "| Day | Team average | Check-ins |",
      "|---|---:|---:|",
      ...logged.map((d) => `| ${d.date} | ${num(d.average)} | ${d.n} |`)
    );
  }
  return `${lines.join("\n")}\n`;
}
