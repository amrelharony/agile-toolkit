import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { HitlReview, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateHitlPrompts(data: { items: HitlReview[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const meanRating = data.items.reduce((s, x) => s + x.rating, 0) / data.items.length;
  const agreementRate = data.items.filter((x) => x.agreedWithModel).length / data.items.length;
  const disagreements = data.items.filter((x) => !x.agreedWithModel).slice(0, 10).map((x) => `- ${x.feature ?? "—"}: ${x.reason ?? "no reason given"}`).join("\n");
  return [
    {
      id: "hitl-insights",
      title: "HITL Quality Insights",
      description: "Find systematic issues in human-vs-model disagreement.",
      prompt:
        buildPreamble("HITL Quality Tracker", "It tracks human reviewer ratings and agreement with model outputs.") +
        `Mean rating: ${meanRating.toFixed(2)}/5 · Agreement rate: ${(agreementRate * 100).toFixed(0)}%\n\n` +
        `## Recent disagreements\n\n${disagreements || "_none_"}\n` + context +
        `\n## Questions\n\n` +
        `1. What pattern do disagreements share? Single root cause or scattered?\n` +
        `2. Are reviewers calibrated with each other? How would you check?\n` +
        `3. Recommend prompt or model changes to address the most common disagreement type.\n` +
        `4. What threshold should trigger a feature pause for re-review?\n` +
        `5. Suggest a sampling strategy to reduce reviewer load while keeping coverage.`,
    },
  ];
}
