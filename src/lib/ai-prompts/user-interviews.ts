import type { PromptDefinition } from "./types";
import { buildPreamble, truncateData } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Interview {
  date: string;
  participant: string;
  context?: string;
  quotes: { text: string; tags: string[] }[];
}

export function generateUserInterviewsPrompts(data: { interviews: Interview[]; tagFrequency: [string, number][] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.interviews.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";
  const quoteLines: string[] = [];
  for (const i of data.interviews) {
    for (const q of i.quotes) {
      if (!q.text) continue;
      // Escape inner double-quotes so embedded quotes don't visually break the
      // outer wrapping quotes in the rendered prompt.
      const safe = q.text.replace(/"/g, '\\"');
      quoteLines.push(`- (${i.participant}) [${q.tags.join(", ")}] "${safe}"`);
    }
  }
  const { data: sample } = truncateData(quoteLines, 40);
  const topTags = data.tagFrequency.slice(0, 10).map(([t, n]) => `${t} (${n})`).join(", ");
  return [
    {
      id: "ui-synthesis",
      title: "Interview Synthesis",
      description: "Cluster quotes into themes and surface insight patterns.",
      prompt:
        buildPreamble("User Interview Log", `${data.interviews.length} interviews. Top tags: ${topTags || "(none)"}.`) +
        `## Quotes\n\n${sample.join("\n")}${wsContext}\n\n## Questions\n\n1. What 3-5 insight themes emerge?\n2. Which quotes are the strongest evidence for each theme?\n3. What product implications follow?`,
    },
    {
      id: "ui-gaps",
      title: "Research Gaps",
      description: "Identify what the team hasn't learned yet.",
      prompt:
        buildPreamble("User Interview Log", "Good research surfaces what you don't know, not just what you do.") +
        `## Tag Frequency\n\n${data.tagFrequency.map(([t, n]) => `- ${t}: ${n}`).join("\n")}${wsContext}\n\n## Questions\n\n1. Which user segments, use cases, or jobs are under-represented?\n2. What contradictory quotes deserve follow-up?\n3. Recommend 3 next interview topics.`,
    },
  ];
}
