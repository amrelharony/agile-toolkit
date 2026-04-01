import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface SprintCompareData {
  sprints: {
    name: string;
    scores: Record<string, number>;
  }[];
}

const DIMENSIONS = ["Velocity", "Quality", "Scope Stability", "Team Happiness", "Goal Achievement", "Predictability"];

export function generateSprintComparePrompts(data: SprintCompareData): PromptDefinition[] {
  if (data.sprints.length === 0) return [];

  const table = formatTable(
    ["Dimension", ...data.sprints.map((s) => s.name)],
    DIMENSIONS.map((d) => [d, ...data.sprints.map((s) => s.scores[d] ?? 0)])
  );

  const avgByDimension = DIMENSIONS.map((d) => {
    const vals = data.sprints.map((s) => s.scores[d] ?? 0);
    return { dim: d, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 };
  }).sort((a, b) => a.avg - b.avg);

  const weakest = avgByDimension[0];
  const strongest = avgByDimension[avgByDimension.length - 1];

  return [
    {
      id: "sprint-compare-trends",
      title: "Sprint Trend Analysis",
      description: "Compare sprints across 6 dimensions to identify improvement trends.",
      prompt: buildPreamble("Sprint Comparison", "It compares multiple sprints across 6 performance dimensions (1-10 scale).") +
        `## Sprint Scores\n\n${table}\n\nWeakest average dimension: ${weakest.dim} (${weakest.avg})\nStrongest average dimension: ${strongest.dim} (${strongest.avg})\n\n## Questions\n\n1. Which dimensions are improving, declining, or staying flat across sprints?\n2. Are there correlations between dimensions (e.g., does high velocity correlate with low quality)?\n3. What story do these scores tell about the team's evolution?\n4. Which dimension should the team prioritize improving? What specific actions would help?\n5. What does the gap between the strongest and weakest dimensions reveal about team priorities?`,
    },
    {
      id: "sprint-compare-coaching",
      title: "Performance Coaching Plan",
      description: "Create a targeted improvement plan based on dimension scores.",
      prompt: buildPreamble("Sprint Comparison", "Design a coaching plan based on multi-sprint performance data.") +
        `## Sprint Scores\n\n${table}\n\n## Questions\n\n1. Create a prioritized improvement plan for the weakest dimension (${weakest.dim}, avg: ${weakest.avg}).\n2. How can the team maintain strength in ${strongest.dim} while improving weaker areas?\n3. What 3 experiments would you suggest for the next sprint to improve overall scores?\n4. Are there any alarming trends that need immediate attention?\n5. Design a brief retrospective exercise focused specifically on the biggest score drop between recent sprints.`,
    },
  ];
}
