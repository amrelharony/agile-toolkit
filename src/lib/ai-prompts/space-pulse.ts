import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface SpaceScoreData {
  quarter: string;
  satisfaction: number;
  performance: number;
  activity: number;
  communication: number;
  efficiency: number;
  description?: string;
}

/**
 * AI prompts for the SPACE Pulse tool.
 *
 * SPACE — Satisfaction, Performance, Activity, Communication, Efficiency —
 * is the GitHub/UMass framework for developer productivity. The prompts
 * surface the dimension that needs the most investment.
 */
export function generateSpacePrompts(data: {
  scores: SpaceScoreData[];
}): PromptDefinition[] {
  if (data.scores.length === 0) return [];
  const latest = data.scores[data.scores.length - 1];
  const scoreTable = formatTable(
    [
      "Quarter",
      "Satisfaction",
      "Performance",
      "Activity",
      "Communication",
      "Efficiency",
      "Description",
    ],
    data.scores.slice(-12).map((s) => [
      s.quarter,
      s.satisfaction,
      s.performance,
      s.activity,
      s.communication,
      s.efficiency,
      (s.description ?? "—").slice(0, 80),
    ])
  );

  return [
    {
      id: "space-analysis",
      title: "SPACE Dimension Analysis",
      description:
        "Diagnose the strongest and weakest SPACE dimensions and propose hypotheses for the gap.",
      prompt:
        buildPreamble(
          "SPACE Pulse",
          `Latest scores (${latest.quarter}): satisfaction ${latest.satisfaction}, performance ${latest.performance}, activity ${latest.activity}, communication ${latest.communication}, efficiency ${latest.efficiency} — each 1-5.`
        ) +
        `## Scores (last ${Math.min(12, data.scores.length)} quarters)\n\n${scoreTable}\n\n## Questions\n\n1. Which dimension is the team's strongest? Which is the weakest, and is the gap growing or shrinking?\n2. What hypotheses might explain the weakest dimension? List 3 plausible drivers.\n3. Which dimensions tend to move together in this team's data?`,
    },
    {
      id: "space-investments",
      title: "Investment Areas",
      description:
        "Prioritise the next quarter of investment based on the lowest SPACE dimensions.",
      prompt:
        buildPreamble(
          "SPACE Pulse",
          `Trend across ${data.scores.length} quarter(s) — most recent ${latest.quarter}.`
        ) +
        `## Scores\n\n${scoreTable}\n\n## Questions\n\n1. Pick the 1-2 dimensions to invest in next quarter and justify the choice.\n2. Suggest concrete, low-cost interventions for each (rituals, tooling, structural changes).\n3. What measurable signal should we look for in the next survey to know if it worked?`,
    },
  ];
}
