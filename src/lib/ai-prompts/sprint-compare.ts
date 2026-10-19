import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface SprintCompareData {
  sprints: {
    name: string;
    /** Ratings 1-10 by dimension. A dimension that wasn't rated is absent. */
    scores: Record<string, number | undefined>;
    /** Points the sprint completed, when recorded. */
    pointsCompleted?: number;
  }[];
}

const DIMENSIONS = [
  "Velocity",
  "Quality",
  "Scope Stability",
  "Team Happiness",
  "Goal Achievement",
  "Predictability",
];

const rated = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function generateSprintComparePrompts(data: SprintCompareData): PromptDefinition[] {
  if (data.sprints.length === 0) return [];
  // Unrated dimensions stay out of the averages (they aren't a score of 0).
  if (!data.sprints.some((s) => DIMENSIONS.some((d) => rated(s.scores[d])))) return [];

  const rows: (string | number)[][] = DIMENSIONS.map((d) => [
    d,
    ...data.sprints.map((s) => {
      const v = s.scores[d];
      return rated(v) ? v : "not rated";
    }),
  ]);
  if (data.sprints.some((s) => rated(s.pointsCompleted))) {
    rows.push([
      "Points completed",
      ...data.sprints.map((s) => (rated(s.pointsCompleted) ? s.pointsCompleted : "not recorded")),
    ]);
  }
  const table = formatTable(["Dimension", ...data.sprints.map((s) => s.name)], rows);

  const avgByDimension = DIMENSIONS.flatMap((d) => {
    const vals = data.sprints.map((s) => s.scores[d]).filter(rated);
    if (vals.length === 0) return [];
    return [{ dim: d, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }];
  }).sort((a, b) => a.avg - b.avg);

  const weakest = avgByDimension[0];
  const strongest = avgByDimension[avgByDimension.length - 1];

  return [
    {
      id: "sprint-compare-trends",
      title: "Sprint Trend Analysis",
      description: "Compare sprints across 6 dimensions to identify improvement trends.",
      prompt:
        buildPreamble(
          "Sprint Comparison",
          'It compares multiple sprints across 6 performance dimensions (1-10 scale), oldest sprint first. "not rated" means the team didn\'t score that dimension.'
        ) +
        `## Sprint Scores\n\n${table}\n\nWeakest average dimension: ${weakest.dim} (${weakest.avg})\nStrongest average dimension: ${strongest.dim} (${strongest.avg})\n\n## Questions\n\n1. Which dimensions are improving, declining, or staying flat across sprints?\n2. Are there correlations between dimensions (e.g., does high velocity correlate with low quality)?\n3. What story do these scores tell about the team's evolution?\n4. Which dimension should the team prioritize improving? What specific actions would help?\n5. What does the gap between the strongest and weakest dimensions reveal about team priorities?`,
    },
    {
      id: "sprint-compare-coaching",
      title: "Performance Coaching Plan",
      description: "Create a targeted improvement plan based on dimension scores.",
      prompt:
        buildPreamble(
          "Sprint Comparison",
          'Design a coaching plan based on multi-sprint performance data. "not rated" means the team didn\'t score that dimension.'
        ) +
        `## Sprint Scores\n\n${table}\n\n## Questions\n\n1. Create a prioritized improvement plan for the weakest dimension (${weakest.dim}, avg: ${weakest.avg}).\n2. How can the team maintain strength in ${strongest.dim} while improving weaker areas?\n3. What 3 experiments would you suggest for the next sprint to improve overall scores?\n4. Are there any alarming trends that need immediate attention?\n5. Design a brief retrospective exercise focused specifically on the biggest score drop between recent sprints.`,
    },
  ];
}
