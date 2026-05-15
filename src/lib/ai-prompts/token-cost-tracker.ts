import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { TokenSpend, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data { items: TokenSpend[]; monthlyBudgetUsd: number; }

export function generateTokenCostPrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const rows = [...data.items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25)
    .map((x) => [x.date, x.feature, x.model, x.inputTokens.toLocaleString(), x.outputTokens.toLocaleString(), `$${x.costUsd.toFixed(2)}`]);
  const table = formatTable(["Date", "Feature", "Model", "In", "Out", "Cost"], rows);

  const total = data.items.reduce((s, x) => s + x.costUsd, 0);
  const byFeature = Object.entries(
    data.items.reduce<Record<string, number>>((m, x) => { m[x.feature] = (m[x.feature] ?? 0) + x.costUsd; return m; }, {}),
  ).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const byFeatureLines = byFeature.map(([f, c]) => `- ${f}: $${c.toFixed(2)}`).join("\n");

  return [
    {
      id: "cost-optimization",
      title: "Cost Optimization",
      description: "Identify the highest-leverage cost-cutting opportunities.",
      prompt:
        buildPreamble("Token-Cost Tracker", "It tracks AI/LLM token spend per feature.") +
        `## Total Spend: $${total.toFixed(2)} | Monthly Budget: $${data.monthlyBudgetUsd.toFixed(0)}\n\n## Top Features\n\n${byFeatureLines}\n\n## Recent Log\n\n${table}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Where is the biggest cost-saving opportunity? Specifically.\n` +
        `2. Which features could move to a smaller/cheaper model without quality loss?\n` +
        `3. Could prompt caching, RAG distillation, or output truncation cut spend? By how much?\n` +
        `4. Are any features showing exponential growth in token use? What likely caused it?\n` +
        `5. Recommend three changes ranked by ROI (cost saved per hour of engineering).`,
    },
  ];
}
