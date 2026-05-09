import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface Hypothesis {
  believe: string;
  willDo: string;
  toLearn: string;
  successMetric: string;
  status: string;
  outcome?: string;
}

export function generateHypothesisTrackerPrompts(data: {
  items: Hypothesis[];
  validationRate: number;
  medianTimeToValidate: number | null;
}): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const table = formatTable(
    ["Believe", "Will Do", "Metric", "Status", "Outcome"],
    data.items.slice(0, 10).map((h) => [h.believe.slice(0, 40), h.willDo.slice(0, 40), h.successMetric.slice(0, 40), h.status, (h.outcome ?? "").slice(0, 40)])
  );
  return [
    {
      id: "hyp-quality",
      title: "Hypothesis Quality Review",
      description: "Coach on whether hypotheses are testable and well-framed.",
      prompt:
        buildPreamble(
          "Hypothesis Tracker",
          `Validation rate: ${Math.round(data.validationRate * 100)}%. Median time-to-learn: ${data.medianTimeToValidate ?? "—"} days.`
        ) +
        `## Hypotheses\n\n${table}\n\n## Questions\n\n1. Which hypotheses are actually testable vs. just opinions?\n2. Are success metrics measurable and falsifiable?\n3. Sharpen the 3 weakest hypotheses.`,
    },
    {
      id: "hyp-portfolio",
      title: "Discovery Portfolio Balance",
      description: "Evaluate risk diversification across the discovery portfolio.",
      prompt:
        buildPreamble("Hypothesis Tracker", "A healthy discovery portfolio mixes low-risk incremental bets with larger directional bets.") +
        `## Hypotheses\n\n${table}\n\n## Questions\n\n1. Are hypotheses too similar? Too diverse?\n2. What's the ratio of cheap tests to expensive ones?\n3. Recommend 2-3 new hypotheses to round out the portfolio.`,
    },
  ];
}
