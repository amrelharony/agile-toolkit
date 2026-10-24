import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import type { WorkingCalendar } from "@/lib/sprints/calendar";
import { sprintStatus } from "@/lib/sprints/metrics";
import { completedAt, dayDate, remainingAt, scopeAt, sortedDays } from "@/lib/sprints/series";
import {
  STATUS_LABEL,
  averageVelocity,
  completedSprints,
  fmt,
  hubTiles,
  sprintDates,
  sprintDayLine,
} from "./hub-view";

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** "2026-10-12" as "12 Oct". */
function shortDate(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/**
 * One sprint as Markdown, for a review page or a stand-up thread: its dates
 * and goal, the hub's numbers, then the daily log.
 */
export function toMarkdown({
  sprint,
  series,
  sprints,
  today,
  calendar,
}: {
  sprint: Sprint;
  series: SprintSeries | undefined;
  /** Every sprint, for the "committed vs average" tile. */
  sprints: readonly Sprint[];
  today: string;
  /** The team's working days (cadenceCalendar): the pace and finish count them. */
  calendar?: WorkingCalendar;
}): string {
  const status = sprintStatus(sprint, series, { calendar });
  const tiles = hubTiles(sprint, status, averageVelocity(completedSprints(sprints), sprint.id));
  const dates = sprintDates(sprint);

  const lines = [`# ${cell(sprint.name) || "Sprint"}`, ""];
  lines.push(
    `**Dates:** ${dates ? `${dates} (${sprintDayLine(sprint, today).toLowerCase()})` : "not set"}  `
  );
  lines.push(`**Status:** ${STATUS_LABEL[sprint.status]}  `);
  if (sprint.goal?.trim()) lines.push(`**Goal:** ${cell(sprint.goal)}  `);

  lines.push(
    "",
    "## Where it stands",
    "",
    "| Measure | Value | Note |",
    "|---|---|---|",
    ...tiles.map(
      (t) =>
        `| ${t.label} | ${cell(t.unit ? `${t.value} ${t.unit}` : t.value)} | ${cell(t.hint ?? "")} |`
    )
  );

  const days = sortedDays(series);
  if (days.length > 0) {
    lines.push(
      "",
      "## Daily log",
      "",
      "| Day | Date | Remaining | Done | Scope | Note |",
      "|---:|---|---:|---:|---:|---|",
      ...days.map((d) => {
        const remaining = remainingAt(sprint, series, d.day);
        const done = completedAt(sprint, series, d.day);
        const note = [d.scopeChange ? "Scope changed" : "", d.note ?? ""]
          .filter((s) => s.trim())
          .join(": ");
        return `| ${d.day} | ${shortDate(dayDate(sprint, d.day))} | ${
          remaining === null ? "—" : fmt(remaining)
        } | ${done === null ? "—" : fmt(done)} | ${fmt(scopeAt(sprint, series, d.day))} | ${cell(
          note
        )} |`;
      })
    );
  } else {
    lines.push("", "No days logged yet.");
  }
  return `${lines.join("\n")}\n`;
}
