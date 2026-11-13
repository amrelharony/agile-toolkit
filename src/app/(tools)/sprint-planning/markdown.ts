import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { storyPoints, totalStoryPoints } from "@/lib/sprints/plan";
import { gwtCell } from "@/lib/stories/fields";
import {
  actionMeta,
  hasImprovements,
  improvementsHeading,
  isReady,
  placeText,
  type Improvements,
  type LeftoverGroup,
} from "./view";

function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const STATUS = (s: Story) => cell(s.status.replace("_", " "));

/**
 * The sprint plan as Markdown: goal, commitment, capacity and the points it
 * suggests, the stories with their readiness, anything a closed sprint
 * left over that is still waiting to be carried over, and what the last
 * retro and the impediments log leave to plan in.
 */
export function planToMarkdown({
  sprint,
  stories,
  capacityHours,
  targetPoints,
  averageVelocity,
  capacityRatio = null,
  suggestedPoints = null,
  leftovers = [],
  improvements,
}: {
  sprint: Sprint;
  stories: readonly Story[];
  capacityHours: number | null;
  targetPoints: number | null;
  averageVelocity: number | null;
  /** Capacity as a share of a normal sprint (lib/sprints/capacity: pointsForecast). */
  capacityRatio?: number | null;
  /** The points the capacity and velocity suggest. */
  suggestedPoints?: number | null;
  leftovers?: readonly LeftoverGroup[];
  /** The last retro's open actions and the open impediments (lib/retro/improvement). */
  improvements?: Improvements;
}): string {
  const lines = [`# ${cell(sprint.name) || "Sprint"} — plan`, ""];
  lines.push(`**Goal:** ${sprint.goal?.trim() ? cell(sprint.goal) : "not set yet"}  `);
  lines.push(
    `**Dates:** ${sprint.startDate.slice(0, 10)} → ${sprint.endDate.slice(0, 10)}  `,
    `**Commitment:** ${totalStoryPoints(stories)} points in ${stories.length} ${
      stories.length === 1 ? "story" : "stories"
    }${targetPoints !== null ? ` (target ${targetPoints})` : ""}  `
  );
  if (capacityHours !== null) {
    lines.push(
      `**Team capacity:** ${capacityHours} hours${
        capacityRatio !== null ? ` (${Math.round(capacityRatio * 100)}% of a normal sprint)` : ""
      }  `
    );
  }
  if (averageVelocity !== null) lines.push(`**Recent velocity:** ${averageVelocity} points  `);
  if (suggestedPoints !== null) {
    lines.push(`**Suggested commitment:** about ${suggestedPoints} points  `);
  }
  lines.push("", "## Stories", "");
  if (stories.length === 0) {
    lines.push("None yet.");
  } else {
    lines.push(
      "| Story | Points | Status | Owner | Ready |",
      "|---|---:|---|---|---|",
      ...stories.map(
        (s) =>
          `| ${cell(s.title)} | ${storyPoints(s) > 0 ? storyPoints(s) : "—"} | ${STATUS(s)} | ${cell(
            s.owner ?? ""
          )} | ${s.status === "done" ? "" : isReady(s) ? "Ready" : "Not refined"} |`
      )
    );
  }
  for (const group of leftovers) {
    lines.push(
      "",
      `## Left over from ${cell(group.sprint.name)}`,
      "",
      `${group.stories.length} ${group.stories.length === 1 ? "story" : "stories"}, ${
        group.points
      } points, not carried over yet:`,
      "",
      ...group.stories.map(
        (s) =>
          `- ${cell(s.title)} (${storyPoints(s) > 0 ? `${storyPoints(s)} points` : "not estimated"}, ${STATUS(s)})`
      )
    );
  }
  if (improvements && hasImprovements(improvements)) {
    // Mid-sentence, so the wording starts lower case; a sprint name in it
    // keeps the team's own case ("in Payments Q4").
    const where = (place: Parameters<typeof placeText>[0]) => {
      const text = cell(placeText(place) ?? "Not planned yet");
      return text.charAt(0).toLowerCase() + text.slice(1);
    };
    const heading = improvementsHeading(improvements);
    lines.push("", `## ${heading.lead}`, "", `${heading.counts}.`);
    if (improvements.actions.length > 0) {
      lines.push(
        "",
        `Retro actions${improvements.retroLabel ? ` (${cell(improvements.retroLabel)})` : ""}:`,
        "",
        ...improvements.actions.map(
          ({ action, place }) =>
            `- ${cell(action.text)} (${cell(actionMeta(action))}${action.overdue ? ", overdue" : ""}): ${where(place)}`
        )
      );
    }
    if (improvements.earlierOpen > 0) {
      lines.push(
        "",
        improvements.earlierOpen === 1
          ? "1 more open action is from an earlier retro."
          : `${improvements.earlierOpen} more open actions are from earlier retros.`
      );
    }
    if (improvements.impediments.length > 0) {
      lines.push(
        "",
        "Open impediments:",
        "",
        ...improvements.impediments.map(
          ({ impediment, place }) =>
            `- ${cell(impediment.title)} (${cell(impediment.severity)}): ${where(place)}`
        )
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The sprint's stories as a CSV, with each one's acceptance criteria both
 * ways: the free text and the Given/When/Then scenarios (one cell each).
 * A download, so the text fields the share link leaves out are in it.
 */
export function planCsv(stories: readonly Story[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: [
      "Story",
      "Points",
      "Status",
      "Owner",
      "Ticket",
      "Acceptance criteria",
      "Given / When / Then",
    ],
    rows: stories.map((s) => [
      s.title,
      storyPoints(s) > 0 ? storyPoints(s) : "",
      s.status.replace("_", " "),
      s.owner ?? "",
      s.ticketKey ?? "",
      s.acceptanceCriteria ?? "",
      gwtCell(s.gwt),
    ]),
  };
}
