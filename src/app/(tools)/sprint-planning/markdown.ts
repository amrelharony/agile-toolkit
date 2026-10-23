import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { storyPoints, totalStoryPoints } from "@/lib/sprints/plan";
import { isReady, type LeftoverGroup } from "./view";

function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const STATUS = (s: Story) => cell(s.status.replace("_", " "));

/**
 * The sprint plan as Markdown: goal, commitment, capacity and the points it
 * suggests, the stories with their readiness, and anything a closed sprint
 * left over that is still waiting to be carried over.
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
  return `${lines.join("\n")}\n`;
}
