import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { NO_VALUE, fmt, type ChartText } from "@/lib/charts/chart-text";
import {
  dayOf,
  daysToComplete,
  milestoneStatus,
  onboardingStats,
  onboardingVerdict,
  rampCurve,
  type MarkStat,
  type Onboardee,
  type RampPoint,
} from "./model";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");
const row = (cells: (string | number)[]) => `| ${cells.map(cell).join(" | ")} |`;

const STATUS_TEXT = {
  done: "done",
  overdue: "overdue",
  "at-risk": "at risk",
  "on-track": "on track",
} as const;

/** "5.0 days (3 people)", or why there's no average yet. */
export function markStatText(s: MarkStat): string {
  if (s.avg !== null) return `${s.avg.toFixed(1)} days (${s.n} people)`;
  return s.n === 0 ? "no one yet" : `not enough data (${s.n} of ${MIN_SAMPLE.average} people)`;
}

/**
 * The ramp's text: the furthest day enough people have reached, and the
 * points behind the curve (only days someone has reached).
 */
export function rampText(points: readonly RampPoint[]): ChartText {
  const shown = points.filter((p) => p.reached > 0);
  const last = [...points].reverse().find((p) => p.avgPct !== null);
  const summary = last
    ? `By day ${last.day}, the ${last.reached} people who have reached it had completed ${Math.round(last.avgPct as number)}% of their milestones on average.`
    : `Not enough people have reached a day yet: each point needs ${MIN_SAMPLE.average}.`;
  return {
    summary,
    table: {
      columns: ["Day", "People reached", "Avg % complete"],
      rows: shown.map((p) => [
        p.day,
        p.reached,
        p.avgPct === null ? NO_VALUE : `${fmt(p.avgPct)}%`,
      ]),
    },
  };
}

/**
 * The tracker as Markdown: the verdict and KPIs, each person's milestones
 * (target, the day reached, days taken, status), and the ramp table.
 */
export function onboardingToMarkdown(people: readonly Onboardee[], today: string): string {
  const stats = onboardingStats(people, today);
  const lines = ["# Onboarding", "", `> ${oneLine(onboardingVerdict(people, today))}`, ""];
  lines.push(
    `- Active: ${stats.active}${stats.finished > 0 ? ` (${stats.finished} finished)` : ""}`,
    `- Overdue / at risk: ${stats.overdue} / ${stats.atRisk}`,
    `- Time to first PR: ${markStatText(stats.firstPr)}`,
    `- Time to productivity: ${markStatText(stats.productive)}`,
    ""
  );
  if (people.length === 0) {
    lines.push("No new joiners yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("## People", "");
  for (const p of people) {
    const day = dayOf(p, today);
    const meta = [
      p.role ? oneLine(p.role) : null,
      p.startDate ? `started ${p.startDate}` : "no start date",
      day !== null ? (day >= 0 ? `day ${day}` : `starts in ${-day} days`) : null,
      p.buddy ? `buddy ${oneLine(p.buddy)}` : null,
    ].filter(Boolean);
    lines.push(`### ${oneLine(p.name)}`, "", meta.join(" · "), "");
    if (p.milestones.length === 0) {
      lines.push("No milestones.", "");
      continue;
    }
    lines.push(
      "| Milestone | Target (days) | Done on | Days | Status |",
      "| --- | --- | --- | --- | --- |",
      ...p.milestones.map((m) =>
        row([
          m.name,
          m.targetDays,
          m.completedAt ?? NO_VALUE,
          daysToComplete(p, m) ?? NO_VALUE,
          STATUS_TEXT[milestoneStatus(day ?? 0, m)],
        ])
      ),
      ""
    );
  }
  const ramp = rampText(rampCurve(people, today));
  if (ramp.table.rows.length > 0) {
    lines.push(
      "## Ramp",
      "",
      ramp.summary,
      "",
      row(ramp.table.columns),
      `| ${ramp.table.columns.map(() => "---").join(" | ")} |`,
      ...ramp.table.rows.map(row),
      ""
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
