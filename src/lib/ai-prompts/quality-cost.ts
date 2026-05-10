import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateQualityCostPrompts(
  data: {
    prevention: number;
    detection: number;
    internalFailure: number;
    externalFailure: number;
    total: number;
    conformance: number;
    nonConformance: number;
    description?: string;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.total === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const pct = (n: number) => `${((n / Math.max(1, data.total)) * 100).toFixed(0)}%`;
  const table = formatTable(
    ["Category", "Cost ($)", "% of total"],
    [
      ["Prevention (conformance)", data.prevention, pct(data.prevention)],
      ["Detection (conformance)", data.detection, pct(data.detection)],
      ["Internal failure (non-conformance)", data.internalFailure, pct(data.internalFailure)],
      ["External failure (non-conformance)", data.externalFailure, pct(data.externalFailure)],
      ["Total", data.total, "100%"],
    ]
  );

  return [
    {
      id: "coq-interpretation",
      title: "COQ Framework Interpretation",
      description:
        "Interpret the conformance vs non-conformance ratio in plain language.",
      prompt:
        buildPreamble(
          "Cost of Quality Calculator",
          `Total cost $${data.total.toLocaleString()}. Conformance $${data.conformance.toLocaleString()} (${pct(data.conformance)}). Non-conformance $${data.nonConformance.toLocaleString()} (${pct(data.nonConformance)}).`
        ) +
        `## Distribution\n\n${table}\n\n${data.description ? `## Notes\n\n${data.description}\n\n` : ""}${wsContext}## Questions\n\n1. Is the conformance/non-conformance ratio healthy? (Mature orgs: ~70/30 or better.)\n2. Where are the heaviest non-conformance costs? What does that imply about the engineering or QA process?\n3. Apply the rule of thumb "$1 in prevention saves ~$100 in failure" to the specific numbers — what's the ROI of a small reallocation?`,
    },
    {
      id: "coq-investment",
      title: "Investment Recommendation",
      description:
        "Recommend where to shift the next dollar of quality spend.",
      prompt:
        buildPreamble(
          "Cost of Quality Calculator",
          `Prevention $${data.prevention.toLocaleString()}, Detection $${data.detection.toLocaleString()}, Internal failure $${data.internalFailure.toLocaleString()}, External failure $${data.externalFailure.toLocaleString()}.`
        ) +
        `## Distribution\n\n${table}${wsContext}\n\n## Questions\n\n1. Where should the next $10K of quality budget go? Justify with the COQ ratio rule.\n2. Are there hidden costs likely missing from this picture (cycle delay, churn, brand damage)?\n3. Recommend 3 concrete prevention investments most likely to compound.`,
    },
  ];
}
