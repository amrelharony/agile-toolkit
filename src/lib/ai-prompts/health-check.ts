import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface HealthCheckData {
  current: {
    sprintName: string;
    scores: Record<string, { light: "green" | "yellow" | "red"; trend: "up" | "same" | "down" }>;
  };
  history: { sprintName: string; scores: Record<string, { light: string; trend: string }> }[];
}

const DIMENSIONS = ["Delivering Value", "Easy to Release", "Fun", "Health of Codebase", "Learning", "Mission", "Speed", "Teamwork"];

export function generateHealthCheckPrompts(data: HealthCheckData): PromptDefinition[] {
  const hasScores = Object.keys(data.current.scores).length > 0;
  if (!hasScores) return [];

  const table = formatTable(
    ["Dimension", "Status", "Trend"],
    DIMENSIONS.map((d) => {
      const s = data.current.scores[d];
      return [d, s?.light?.toUpperCase() ?? "N/A", s?.trend === "up" ? "↑ Improving" : s?.trend === "down" ? "↓ Declining" : "→ Stable"];
    })
  );

  const reds = DIMENSIONS.filter((d) => data.current.scores[d]?.light === "red");
  const yellows = DIMENSIONS.filter((d) => data.current.scores[d]?.light === "yellow");
  const declining = DIMENSIONS.filter((d) => data.current.scores[d]?.trend === "down");

  return [
    {
      id: "health-deepdive",
      title: "Team Health Deep Dive",
      description: "Prioritize health dimensions and design targeted interventions.",
      prompt: buildPreamble("Team Health Check", `The team assessed 8 dimensions using traffic lights (Green/Yellow/Red) and trends (↑/→/↓) for sprint "${data.current.sprintName}".`) +
        `## Current Health Assessment\n\n${table}\n\n🔴 Red dimensions: ${reds.length > 0 ? reds.join(", ") : "None"}\n🟡 Yellow dimensions: ${yellows.length > 0 ? yellows.join(", ") : "None"}\n📉 Declining dimensions: ${declining.length > 0 ? declining.join(", ") : "None"}\n\n## Questions\n\n1. Prioritize the health dimensions that need immediate attention. Which should be addressed first and why?\n2. For each red or declining dimension, suggest 2-3 specific interventions.\n3. What root causes might connect multiple unhealthy dimensions?\n4. How can the team leverage their green dimensions to improve weaker areas?\n5. Design a focused 15-minute discussion for the team's next retrospective based on these results.`,
    },
    {
      id: "health-facilitation",
      title: "Health Check Facilitation Guide",
      description: "Generate discussion questions and exercises based on the lowest-scoring dimensions.",
      prompt: buildPreamble("Team Health Check", "Design facilitation activities based on the health check results.") +
        `## Current Health Assessment\n\n${table}\n\n## Questions\n\n1. Create 3 powerful discussion questions for each red or yellow dimension.\n2. Design a 10-minute team exercise that addresses the most critical health gap.\n3. What signals should the Scrum Master watch for that indicate these dimensions are improving?\n4. How should the team celebrate or protect their green dimensions from declining?\n5. Draft an improvement experiment the team can try next sprint — state hypothesis, action, and success metric.`,
    },
  ];
}
