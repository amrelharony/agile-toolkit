import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { WeightedCriterion, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data {
  criteria: WeightedCriterion[];
  ranked: { id: string; name: string; scores: Record<string, number>; score: number }[];
}

export function generateWeightedPrompts(
  data: Data,
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.ranked.length === 0 || data.criteria.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const headers = ["Option", ...data.criteria.map((c) => `${c.name} (w${c.weight})`), "Total"];
  // An unscored cell isn't a 0 (scores run 1–10); say so, as the page does.
  const rows = data.ranked.map((o) => [
    o.name,
    ...data.criteria.map((c) => o.scores[c.id] ?? "not scored"),
    o.score.toFixed(2),
  ]);
  const table = formatTable(headers, rows);
  return [
    {
      id: "weighted-sensitivity",
      title: "Sensitivity Check",
      description: "Probe whether the winner survives changes to weights and scores.",
      prompt:
        buildPreamble("Weighted Decision Matrix", "It scores options against weighted criteria.") +
        `## Matrix\n\n${table}\n` +
        context +
        `\n## Questions\n\n` +
        `1. If we doubled the top criterion's weight, would the winner change?\n` +
        `2. Are any criteria highly correlated (double-counting the same thing)?\n` +
        `3. Which scores are weakest (low confidence) and could swing the result?\n` +
        `4. Is the winning option a clear leader or a coin-flip vs #2?\n` +
        `5. What additional criterion would meaningfully change the ranking?`,
    },
  ];
}
