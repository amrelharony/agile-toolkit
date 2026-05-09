import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface DoraSampleData {
  quarter: string;
  deployFreqPerWeek: number;
  leadTimeHours: number;
  changeFailRate: number;
  mttrHours: number;
  description?: string;
}

/**
 * AI prompts for the DORA Scorecard tool.
 *
 * The two prompts cover the typical engineering-leader question loop:
 * 1. "Where do we sit on the Accelerate banding?" (assessment)
 * 2. "What should we work on next quarter to climb?" (roadmap)
 */
export function generateDoraPrompts(data: {
  samples: DoraSampleData[];
}): PromptDefinition[] {
  if (data.samples.length === 0) return [];
  const latest = data.samples[data.samples.length - 1];
  const sampleTable = formatTable(
    [
      "Quarter",
      "Deploy/wk",
      "Lead (h)",
      "CFR",
      "MTTR (h)",
      "Description",
    ],
    data.samples.slice(-12).map((s) => [
      s.quarter,
      s.deployFreqPerWeek.toFixed(2),
      s.leadTimeHours.toFixed(1),
      `${(s.changeFailRate * 100).toFixed(1)}%`,
      s.mttrHours.toFixed(1),
      (s.description ?? "—").slice(0, 80),
    ])
  );

  return [
    {
      id: "dora-assessment",
      title: "DORA Performance Assessment",
      description:
        "Rate the team against Accelerate Elite/High/Medium/Low bands and explain the diagnosis.",
      prompt:
        buildPreamble(
          "DORA Scorecard",
          `Latest sample (${latest.quarter}): deploy ${latest.deployFreqPerWeek.toFixed(2)}/wk, lead ${latest.leadTimeHours.toFixed(1)}h, change-fail ${(latest.changeFailRate * 100).toFixed(1)}%, MTTR ${latest.mttrHours.toFixed(1)}h.`
        ) +
        `## Samples (last ${Math.min(12, data.samples.length)} quarters)\n\n${sampleTable}\n\n## Questions\n\n1. Place each metric in its Accelerate band (Elite / High / Medium / Low) and justify briefly.\n2. Which metric is the team's strongest signal? Which is the weakest?\n3. Are the constraints upstream (lead time, deploy frequency) or downstream (CFR, MTTR)?`,
    },
    {
      id: "dora-roadmap",
      title: "Improvement Roadmap",
      description:
        "Suggest a sequenced, 1-quarter improvement plan focused on the weakest DORA dimension.",
      prompt:
        buildPreamble(
          "DORA Scorecard",
          `Trend across ${data.samples.length} quarter(s) — most recent ${latest.quarter}.`
        ) +
        `## Samples\n\n${sampleTable}\n\n## Questions\n\n1. Identify the weakest 1-2 DORA metrics from the trend.\n2. Suggest 3 concrete, sequenced engineering practices to address them next quarter (trunk-based, feature flags, smaller PRs, etc.).\n3. What leading indicators should we track week-over-week to know if the practices are working?`,
    },
  ];
}
