import type { Impediment, Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { STATUS_LABEL, fmt, points, sprintDates, sprintDayLine } from "@/lib/sprints/hub-view";
import { completedAt, dayDate, remainingAt, scopeAt, sortedDays } from "@/lib/sprints/series";
import {
  IMPEDIMENT_SEVERITY_LABEL,
  IMPEDIMENT_STATUS_LABEL,
  daysOverdue,
  impedimentStatus,
} from "@/lib/impediments/model";
import { cockpitTiles, localDay, type CockpitData } from "./view";
import { cockpitVerdict } from "./verdict";

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const STORY_STATUS: Record<Story["status"], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

function impedimentState(i: Impediment, today: string): string {
  const late = daysOverdue(i, today);
  const status = IMPEDIMENT_STATUS_LABEL[impedimentStatus(i)];
  return late > 0 ? `${status} · ${plural(late, "day")} overdue` : status;
}

export interface CockpitMarkdownInput {
  data: CockpitData;
  series: SprintSeries | undefined;
  /** Every sprint, for the "committed vs average" tile. */
  sprints: readonly Sprint[];
  today: string;
  /**
   * The rating the cockpit's tile shows: Sprint Comparison's computed
   * average (lib/sprints/compare). Absent: the typed ratings', as the tile.
   */
  rating?: number | null;
}

/**
 * The sprint's status as one Markdown document, for the review, the wiki or
 * a stakeholder thread: the verdict and the cockpit's numbers (from the
 * board when it has pointed stories, else the daily log), the stories, the
 * day's standup, what got in the way during the sprint, and this sprint's
 * retro and review.
 */
export function cockpitMarkdown({
  data,
  series,
  sprints,
  today,
  rating,
}: CockpitMarkdownInput): string {
  const { sprint, burndown, progress } = data;
  const board = burndown.source === "stories";
  const tiles = cockpitTiles(data, sprints, today, { rating });
  const dates = sprintDates(sprint);

  const lines = [`# ${cell(sprint.name) || "Sprint"}`, ""];
  lines.push(
    `**Dates:** ${dates ? `${dates} (${sprintDayLine(sprint, today).toLowerCase()})` : "not set"}  `,
    `**Status:** ${STATUS_LABEL[sprint.status]}  `
  );
  if (sprint.goal?.trim()) lines.push(`**Goal:** ${cell(sprint.goal)}  `);
  lines.push("", cockpitVerdict(data, today));

  lines.push(
    "",
    "## Where it stands",
    "",
    "| Measure | Value | Note |",
    "|---|---|---|",
    ...tiles.map(
      (t) =>
        `| ${t.label} | ${cell(t.unit ? `${t.value} ${t.unit}` : t.value)} | ${cell(t.hint ?? "")} |`
    ),
    "",
    sprint.status === "completed" && typeof sprint.pointsCompleted === "number"
      ? `Done is what was confirmed when the sprint closed; ${
          burndown.source === "log"
            ? "the rest is typed in the daily log."
            : "no daily log was typed for it."
        }`
      : board
        ? "Done and remaining are read from the sprint board's stories."
        : burndown.source === "log"
          ? "Done and remaining are typed in the daily log."
          : "Nothing on the board or in the daily log yet."
  );

  if (board) {
    const read = burndown.rows.filter((r) => typeof r.actual === "number");
    if (read.length > 0) {
      lines.push(
        "",
        "## Burndown from the board",
        "",
        "| Day | Date | Ideal | Remaining |",
        "|---:|---|---:|---:|",
        ...read.map(
          (r) =>
            `| ${r.day} | ${shortDate(dayDate(sprint, r.day))} | ${fmt(r.ideal)} | ${fmt(
              r.actual as number
            )} |`
        )
      );
    }
  } else {
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
    }
  }

  lines.push("", "## Sprint backlog", "");
  const stories = data.sprintStories;
  if (stories.length === 0) {
    lines.push("No stories planned into this sprint.");
  } else {
    lines.push(
      `${progress.doneCount} of ${progress.count} stories done · ${fmt(progress.done)} of ${points(
        progress.scope
      )}.`,
      "",
      "| Story | Points | Status | Owner |",
      "|---|---:|---|---|",
      ...stories.map(
        (s) =>
          `| ${cell(s.title)} | ${typeof s.points === "number" ? fmt(s.points) : "—"} | ${
            STORY_STATUS[s.status] ?? cell(s.status)
          }${s.blocked && s.status !== "done" ? " · blocked" : ""} | ${cell(s.owner ?? "")} |`
      )
    );
  }

  const { standup } = data;
  lines.push("", "## Daily Scrum today", "");
  if (standup.posted === 0) {
    lines.push("No updates posted yet today.");
  } else {
    lines.push(
      `${standup.posted}${standup.members > 0 ? ` of ${standup.members}` : ""} updated today${
        standup.blockers > 0 ? `, ${standup.blockers} with a blocker.` : ", no blockers raised."
      }`
    );
  }

  lines.push("", "## Impediments in the sprint", "");
  if (data.sprintImpediments.length === 0) {
    lines.push("Nothing got in the way.");
  } else {
    lines.push(
      "| Impediment | Severity | Raised | Owner | Status |",
      "|---|---|---|---|---|",
      ...data.sprintImpediments.map(
        (i) =>
          `| ${cell(i.title)} | ${IMPEDIMENT_SEVERITY_LABEL[i.severity] ?? cell(i.severity)} | ${cell(
            i.raisedAt.slice(0, 10)
          )} | ${cell(i.owner ?? "")} | ${impedimentState(i, today)} |`
      )
    );
  }
  if (data.blockedStories.length > 0) {
    lines.push(
      "",
      "**Blocked stories:**",
      ...data.blockedStories.map((s) => `- ${cell(s.title)}${s.owner ? ` (${cell(s.owner)})` : ""}`)
    );
  }

  lines.push("", "## Retrospective", "");
  const { retro } = data;
  if (retro.currentCards > 0) {
    lines.push(`In progress: ${plural(retro.currentCards, "card")} on the board.`);
  } else if (retro.archivedAt) {
    const day = localDay(retro.archivedAt);
    lines.push(`Held${day ? ` (archived ${shortDate(day)})` : ""}.`);
  } else {
    lines.push("No retro for this sprint yet.");
  }
  if (data.openActions.length > 0) {
    lines.push(
      "",
      "**Open actions:**",
      ...data.openActions.map(
        (a) =>
          `- ${cell(a.text)} — ${a.assignee.trim() ? `Owner: ${cell(a.assignee)}` : "No owner yet"}${
            a.overdue ? " (overdue)" : ""
          }`
      )
    );
  }

  lines.push("", "## Sprint Review", "");
  const review = data.reviewDoc;
  if (!review || (review.features.length === 0 && review.feedbackItems.length === 0)) {
    lines.push("No demo script or feedback recorded yet.");
  } else {
    if (data.review.fromDraft) {
      lines.push("From the draft review: this sprint has no review of its own yet.", "");
    }
    if (review.features.length > 0) {
      lines.push(
        "**Demo:**",
        ...review.features.map(
          (d) => `- ${cell(d.name)}${d.timeMinutes ? ` (${d.timeMinutes} min)` : ""}`
        )
      );
    }
    if (review.feedbackItems.length > 0) {
      if (review.features.length > 0) lines.push("");
      lines.push(
        "**Stakeholder feedback:**",
        ...review.feedbackItems.map(
          (f) => `- ${cell(f.stakeholder) || "Someone"} (${cell(f.category)}): ${cell(f.feedback)}`
        )
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
