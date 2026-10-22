import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { storyPoints, totalStoryPoints } from "@/lib/sprints/plan";

function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/** The sprint plan as Markdown: goal, commitment, capacity, the stories. */
export function planToMarkdown({
  sprint,
  stories,
  capacityHours,
  targetPoints,
  averageVelocity,
}: {
  sprint: Sprint;
  stories: readonly Story[];
  capacityHours: number | null;
  targetPoints: number | null;
  averageVelocity: number | null;
}): string {
  const lines = [`# ${cell(sprint.name) || "Sprint"} — plan`, ""];
  lines.push(`**Goal:** ${sprint.goal?.trim() ? cell(sprint.goal) : "not set yet"}  `);
  lines.push(
    `**Dates:** ${sprint.startDate.slice(0, 10)} → ${sprint.endDate.slice(0, 10)}  `,
    `**Commitment:** ${totalStoryPoints(stories)} points in ${stories.length} ${
      stories.length === 1 ? "story" : "stories"
    }${targetPoints !== null ? ` (target ${targetPoints})` : ""}  `
  );
  if (capacityHours !== null) lines.push(`**Team capacity:** ${capacityHours} hours  `);
  if (averageVelocity !== null) lines.push(`**Recent velocity:** ${averageVelocity} points  `);
  lines.push("", "## Stories", "");
  if (stories.length === 0) {
    lines.push("None yet.");
  } else {
    lines.push(
      "| Story | Points | Status | Owner |",
      "|---|---:|---|---|",
      ...stories.map(
        (s) =>
          `| ${cell(s.title)} | ${storyPoints(s) > 0 ? storyPoints(s) : "—"} | ${cell(
            s.status.replace("_", " ")
          )} | ${cell(s.owner ?? "")} |`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
