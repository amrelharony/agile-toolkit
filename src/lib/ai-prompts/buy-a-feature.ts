import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateBuyAFeaturePrompts(data: { items: PrioritizationItem[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.map((it) => {
    const p = Number(it.fields?.price) || 0;
    const r = Number(it.fields?.raised) || 0;
    return [it.title, `$${p}`, `$${r}`, p > 0 ? `${Math.round((r / p) * 100)}%` : "—"];
  });
  const table = formatTable(["Feature", "Price", "Raised", "Funded"], rows);
  return [
    {
      id: "buy-feature-debrief",
      title: "Game Debrief",
      description: "Read the signal from purchase patterns.",
      prompt:
        buildPreamble("Buy-a-Feature", "It surfaces stakeholder priorities through fake-currency purchases.") +
        `${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Which features got disproportionate buy-in vs price?\n` +
        `2. Which features were ignored — was the price wrong, or the value unclear?\n` +
        `3. Did stakeholders coalesce or scatter? What does that imply about alignment?\n` +
        `4. Recommend three features to take forward into the roadmap.\n` +
        `5. What should the next round's price points be?`,
    },
  ];
}
