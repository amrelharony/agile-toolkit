import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface MaturityData {
  dimensions: { name: string; currentScore: number; targetScore: number }[];
  overallScore: number;
  targetLevel: number;
}

export function generateMaturityPrompts(data: MaturityData): PromptDefinition[] {
  if (data.dimensions.length === 0) return [];

  const table = formatTable(
    ["Dimension", "Current (1-5)", "Target", "Gap"],
    data.dimensions.map((d) => [d.name, d.currentScore, d.targetScore, d.targetScore - d.currentScore])
  );

  const biggestGaps = [...data.dimensions]
    .sort((a, b) => (b.targetScore - b.currentScore) - (a.targetScore - a.currentScore))
    .slice(0, 3);

  return [
    {
      id: "maturity-gap",
      title: "Maturity Gap Analysis",
      description: "Identify the biggest gaps and create a prioritized improvement sequence.",
      prompt: buildPreamble("Agile Maturity Assessment", "It rates the team across multiple agile dimensions on a 1-5 scale against target levels.") +
        `## Assessment Results\n\nOverall Score: ${data.overallScore}%\nTarget Level: ${data.targetLevel}\n\n${table}\n\nBiggest gaps: ${biggestGaps.map((d) => `${d.name} (gap: ${d.targetScore - d.currentScore})`).join(", ")}\n\n## Questions\n\n1. In what order should the team address these gaps? What's the optimal improvement sequence?\n2. For each dimension with a gap > 1, what specific practices would bridge the gap?\n3. Are there dependencies between dimensions (e.g., must improve X before Y)?\n4. What quick wins could move the overall maturity score in the next 4 weeks?\n5. Is the target level realistic for this team? Should any targets be adjusted?`,
    },
    {
      id: "maturity-roadmap",
      title: "Quarterly Improvement Roadmap",
      description: "Design a quarter-by-quarter plan to reach the target maturity level.",
      prompt: buildPreamble("Agile Maturity Assessment", "Create a phased improvement roadmap.") +
        `## Assessment Results\n\nOverall Score: ${data.overallScore}%\nTarget Level: ${data.targetLevel}\n\n${table}\n\n## Questions\n\n1. Design a 3-quarter roadmap to reach the target maturity level for the top 3 gap dimensions.\n2. For each quarter, specify: focus area, practices to adopt, success metrics, and expected maturity gain.\n3. What training or coaching investments would accelerate improvement?\n4. How should progress be measured — what milestones indicate real maturity gain vs. superficial compliance?\n5. What organizational support does the team need to succeed? Draft a brief request for leadership.`,
    },
  ];
}
