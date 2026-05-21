import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { ModelEntry, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateModelComparisonPrompts(data: { items: ModelEntry[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.slice(0, 20).map((m) => [
    m.name, m.vendor,
    m.inputCostPer1k != null ? `$${m.inputCostPer1k}` : "—",
    m.outputCostPer1k != null ? `$${m.outputCostPer1k}` : "—",
    m.contextWindow?.toLocaleString() ?? "—",
    m.latencyP95Ms ?? "—",
    m.evalScore != null ? `${(m.evalScore * 100).toFixed(0)}%` : "—",
    m.status,
  ]);
  const table = formatTable(["Model", "Vendor", "In/1k", "Out/1k", "Ctx", "p95ms", "Eval", "Status"], rows);

  return [
    {
      id: "model-selection",
      title: "Model Selection Recommendation",
      description: "Recommend the best model per use case from the comparison set.",
      prompt:
        buildPreamble("Model Comparison Matrix", "It compares LLMs across cost, latency, context window, and eval score.") +
        `## Models\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. For high-volume / low-stakes tasks (e.g. classification), which model is best per dollar?\n` +
        `2. For low-volume / high-stakes tasks (e.g. final reasoning), which model wins on quality?\n` +
        `3. Which model has the best price/performance ratio overall?\n` +
        `4. Are we over-relying on any single vendor? What's the migration risk?\n` +
        `5. Recommend a tiering strategy: which models to use in fast path vs deep path.`,
    },
  ];
}
