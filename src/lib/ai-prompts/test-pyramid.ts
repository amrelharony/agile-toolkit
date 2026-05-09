import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

export function generateTestPyramidPrompts(data: {
  unit: number;
  integration: number;
  e2e: number;
  total: number;
  unitPct: number;
  e2ePct: number;
  inverted: boolean;
  costEstimate: number;
  description?: string;
}): PromptDefinition[] {
  if (data.total === 0) return [];

  const table = formatTable(
    ["Layer", "Count", "% of total"],
    [
      ["Unit", data.unit, `${(data.total ? (data.unit / data.total) * 100 : 0).toFixed(0)}%`],
      ["Integration", data.integration, `${(data.total ? (data.integration / data.total) * 100 : 0).toFixed(0)}%`],
      ["E2E", data.e2e, `${data.e2ePct.toFixed(0)}%`],
    ]
  );

  const shape = data.inverted
    ? "INVERTED — e2e count exceeds unit count, an anti-pattern."
    : data.unitPct >= 60
      ? "Healthy pyramid shape (unit-heavy)."
      : "Mid-shape — neither inverted nor classically pyramidal.";

  return [
    {
      id: "pyramid-diagnosis",
      title: "Pyramid Health Diagnosis",
      description:
        "Evaluate the current unit/integration/e2e ratio and call out anti-patterns.",
      prompt:
        buildPreamble(
          "Test Pyramid Analyzer",
          `Total ${data.total} test(s) — unit ${data.unit}, integration ${data.integration}, e2e ${data.e2e}. ${shape} Estimated cost-of-quality units: ${data.costEstimate}.`
        ) +
        `## Counts\n\n${table}\n\n${data.description ? `## Notes\n\n${data.description}\n\n` : ""}## Questions\n\n1. Is the shape healthy, inverted, or hourglass? Diagnose with specifics.\n2. What does the cost-of-quality estimate (unit=1, integration=5, e2e=25) suggest about feedback-loop efficiency?\n3. Identify the single biggest concern and the single biggest strength.`,
    },
    {
      id: "pyramid-rebalance",
      title: "Rebalancing Strategy",
      description:
        "Recommend a sequenced plan to move toward a healthier pyramid shape.",
      prompt:
        buildPreamble(
          "Test Pyramid Analyzer",
          `Current: unit ${data.unit}, integration ${data.integration}, e2e ${data.e2e} (total ${data.total}).`
        ) +
        `## Counts\n\n${table}\n\n## Questions\n\n1. Suggest a 2-quarter plan to shift the ratio toward a healthier shape — concrete moves, not generic advice.\n2. Are there e2e tests that should likely be down-shifted to integration or unit? How would you identify them?\n3. What contract/integration testing patterns would close the most coverage at the lowest ongoing cost?`,
    },
  ];
}
