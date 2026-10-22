/**
 * The sprint report: one Markdown document for the review, the wiki or a
 * stakeholder thread. It starts with the Sprint Metrics summary (dates,
 * goal, numbers, daily log) and adds what the other tools know about the
 * sprint: the planned stories, today's standup, open impediments, the last
 * retro's actions and the review's demo items and feedback.
 */

import type { Impediment, Sprint, SprintSeries, Story } from "@/lib/stores/workspace-types";
import { toMarkdown } from "./markdown";
import { fmt } from "./hub-view";

export interface ReportStandup {
  posted: number;
  members: number;
  blockers: number;
}

export interface ReportRetroAction {
  text: string;
  assignee?: string;
}

export interface ReportReview {
  demoItems: { name: string; timeMinutes?: number }[];
  feedback: { stakeholder: string; feedback: string; category: string }[];
}

export interface SprintReportInput {
  sprint: Sprint;
  series: SprintSeries | undefined;
  /** Every sprint, for the "committed vs average" tile. */
  sprints: readonly Sprint[];
  today: string;
  stories: readonly Story[];
  openImpediments: readonly Impediment[];
  standup: ReportStandup;
  retroActions: readonly ReportRetroAction[];
  review: ReportReview | null;
}

function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const STORY_STATUS: Record<Story["status"], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

const SEVERITY: Record<Impediment["severity"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function sprintReport(input: SprintReportInput): string {
  const {
    sprint,
    series,
    sprints,
    today,
    stories,
    openImpediments,
    standup,
    retroActions,
    review,
  } = input;
  const lines = [toMarkdown({ sprint, series, sprints, today }).trimEnd(), ""];

  lines.push("## Sprint backlog", "");
  if (stories.length === 0) {
    lines.push("No stories planned into this sprint.");
  } else {
    const done = stories.filter((s) => s.status === "done");
    const points = (list: readonly Story[]) => list.reduce((sum, s) => sum + (s.points ?? 0), 0);
    lines.push(
      `${done.length} of ${stories.length} stories done · ${fmt(points(done))} of ${fmt(
        points(stories)
      )} points.`,
      "",
      "| Story | Points | Status | Owner |",
      "|---|---:|---|---|",
      ...stories.map(
        (s) =>
          `| ${cell(s.title)} | ${typeof s.points === "number" ? fmt(s.points) : "—"} | ${
            STORY_STATUS[s.status]
          } | ${cell(s.owner ?? "")} |`
      )
    );
  }

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

  lines.push("", "## Open impediments", "");
  if (openImpediments.length === 0) {
    lines.push("Nothing open.");
  } else {
    lines.push(
      "| Impediment | Severity | Raised | Owner |",
      "|---|---|---|---|",
      ...openImpediments.map(
        (i) =>
          `| ${cell(i.title)} | ${SEVERITY[i.severity]} | ${cell(i.raisedAt.slice(0, 10))} | ${cell(
            i.owner ?? ""
          )} |`
      )
    );
  }

  lines.push("", "## Actions from the last retro", "");
  if (retroActions.length === 0) {
    lines.push("No open actions.");
  } else {
    lines.push(
      ...retroActions.map(
        (a) =>
          `- ${cell(a.text)} — ${a.assignee?.trim() ? `Owner: ${cell(a.assignee)}` : "No owner yet"}`
      )
    );
  }

  lines.push("", "## Sprint Review", "");
  if (!review || (review.demoItems.length === 0 && review.feedback.length === 0)) {
    lines.push("No demo script or feedback recorded yet.");
  } else {
    if (review.demoItems.length > 0) {
      lines.push(
        "**Demo:**",
        ...review.demoItems.map(
          (d) => `- ${cell(d.name)}${d.timeMinutes ? ` (${d.timeMinutes} min)` : ""}`
        )
      );
    }
    if (review.feedback.length > 0) {
      if (review.demoItems.length > 0) lines.push("");
      lines.push(
        "**Stakeholder feedback:**",
        ...review.feedback.map(
          (f) => `- ${cell(f.stakeholder) || "Someone"} (${cell(f.category)}): ${cell(f.feedback)}`
        )
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
