/**
 * The DEEP scan as Markdown (the checks and their reasons, the flagged
 * stories, and the top stories' acceptance criteria both ways: free text
 * and Given/When/Then) and as a CSV of every backlog story.
 */

import { storyPoints } from "@/lib/sprints/plan";
import { gwtCell, gwtLines } from "@/lib/stories/fields";
import { STORY_FLAG_LABEL, type BacklogHealth } from "@/lib/backlog/health";

const line = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** Long text kept short in a share link (which is capped). */
const cap = (s: string, max = 300) => {
  const t = line(s);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export function toMarkdown(health: BacklogHealth, today: string): string {
  const lines = ["# Backlog health", "", `As of ${today}.`, ""];
  if (health.total === 0) {
    lines.push(health.summary);
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `**DEEP score:** ${health.score === null ? "can't tell yet" : `${health.score}%`}  `,
    `**Stories in the backlog:** ${health.total} (top ${Math.min(health.topN, health.total)} checked for detail)  `,
    "",
    health.summary,
    "",
    "## The four checks",
    ""
  );
  for (const c of health.checks) {
    lines.push(
      `### ${c.label}: ${c.score === null ? "can't tell" : `${Math.round(c.score * 100)}%`}`,
      ""
    );
    for (const r of c.reasons) lines.push(`- ${r}`);
    lines.push("");
  }
  lines.push("## Stories to look at", "");
  const flagged = health.stories.filter((s) => s.flags.length > 0);
  if (flagged.length === 0) lines.push("None: no story is flagged.");
  for (const s of flagged) {
    lines.push(
      `- ${s.place}. ${cap(s.story.title, 200)}: ${s.flags.map((f) => STORY_FLAG_LABEL[f.id]).join(", ")}`
    );
  }
  lines.push("", "## Acceptance criteria at the top of the backlog", "");
  for (const s of health.stories.filter((x) => x.top)) {
    lines.push(`### ${s.place}. ${cap(s.story.title, 200)}`, "");
    const free = s.story.acceptanceCriteria?.trim();
    const gwt = gwtLines(s.story.gwt);
    if (!free && gwt.length === 0) lines.push("No acceptance criteria yet.");
    if (free) lines.push(cap(free, 600));
    if (free && gwt.length > 0) lines.push("");
    if (gwt.length > 0) lines.push("```gherkin", ...gwt.map((l) => cap(l, 300)), "```");
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Every backlog story with its flags and both kinds of acceptance criteria. */
export function healthCsv(health: BacklogHealth): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: [
      "Place",
      "Story",
      "Points",
      "Flags",
      "Acceptance criteria",
      "Given / When / Then",
      "Last touched",
    ],
    rows: health.stories.map((s) => [
      s.place,
      s.story.title,
      storyPoints(s.story) > 0 ? storyPoints(s.story) : "",
      s.flags.map((f) => STORY_FLAG_LABEL[f.id]).join("; "),
      s.story.acceptanceCriteria ?? "",
      gwtCell(s.story.gwt),
      s.touched ?? "",
    ]),
  };
}
