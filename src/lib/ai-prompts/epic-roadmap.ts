import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface Epic {
  title: string;
  startQuarter: string;
  endQuarter: string;
  progress: number;
  owner?: string;
  description?: string;
}

export function generateEpicRoadmapPrompts(data: { epics: Epic[]; columns: string[] }): PromptDefinition[] {
  if (data.epics.length === 0) return [];
  const table = formatTable(
    ["Epic", "Start", "End", "Progress", "Owner", "Description"],
    data.epics.map((e) => [e.title, e.startQuarter, e.endQuarter, `${e.progress}%`, e.owner ?? "", (e.description ?? "—").slice(0, 80)])
  );
  return [
    {
      id: "roadmap-realism",
      title: "Roadmap Realism",
      description: "Evaluate whether the roadmap is achievable or overcommitted.",
      prompt:
        buildPreamble(
          "Epic Roadmap",
          `Roadmap spans ${data.columns.length} quarters and ${data.epics.length} epics.`
        ) +
        `## Epics\n\n${table}\n\n## Questions\n\n1. Is there too much parallel work?\n2. Which epics are trailing and why?\n3. Recommend 2-3 deliverable adjustments (defer, split, descope).`,
    },
    {
      id: "roadmap-focus",
      title: "Strategic Focus",
      description: "Ensure the roadmap reflects strategy, not just work-in-flight.",
      prompt:
        buildPreamble("Epic Roadmap", "Great roadmaps answer why these bets, why now, why in this order.") +
        `## Epics\n\n${table}\n\n## Questions\n\n1. Which epics actually move the strategy vs. being maintenance?\n2. What's missing from the roadmap?\n3. If you had to drop one epic, which and why?`,
    },
  ];
}
