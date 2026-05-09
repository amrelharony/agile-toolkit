import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface PlatformDimensionData {
  id: string;
  label: string;
  score: number; // 1-5
  description?: string;
}

/**
 * AI prompts for the Platform Engineering Maturity tool.
 *
 * The two prompts cover the typical platform-leader question loop:
 *   1. Where are the gaps?
 *   2. Where to invest next?
 */
export function generatePlatformMaturityPrompts(data: {
  dimensions: PlatformDimensionData[];
}): PromptDefinition[] {
  if (data.dimensions.length === 0) return [];
  const avg =
    data.dimensions.reduce((a, d) => a + d.score, 0) / data.dimensions.length;
  const dimTable = formatTable(
    ["Dimension", "Score", "Description"],
    data.dimensions.map((d) => [
      d.label,
      `${d.score}/5`,
      (d.description ?? "—").slice(0, 80),
    ])
  );

  return [
    {
      id: "platform-gaps",
      title: "Platform Gaps",
      description:
        "Identify the weakest 2-3 platform dimensions and explain the consequences of leaving them at the current level.",
      prompt:
        buildPreamble(
          "Platform Engineering Maturity",
          `Average maturity ${avg.toFixed(2)}/5 across ${data.dimensions.length} dimensions.`
        ) +
        `## Dimensions\n\n${dimTable}\n\n## Questions\n\n1. Identify the 2-3 weakest dimensions and the typical consequences of leaving them at this level (developer toil, cognitive load, incident risk, etc.).\n2. Are the gaps clustered (e.g. all "developer self-service") or spread evenly?\n3. What's a 1-paragraph "current state" summary you would share with engineering leadership?`,
    },
    {
      id: "platform-investment",
      title: "Investment Prioritization",
      description:
        "Recommend a 1-quarter sequenced investment plan focused on the highest-leverage dimensions.",
      prompt:
        buildPreamble(
          "Platform Engineering Maturity",
          `Avg ${avg.toFixed(2)}/5 — ${data.dimensions.filter((d) => d.score < 3).length} dimension(s) below "Repeatable" (3).`
        ) +
        `## Dimensions\n\n${dimTable}\n\n## Questions\n\n1. Pick the 2 highest-leverage dimensions to invest in next quarter and justify the choice.\n2. For each, name 2-3 concrete deliverables that would move it from level N to N+1.\n3. What do we deliberately NOT invest in this quarter, and why?`,
    },
  ];
}
