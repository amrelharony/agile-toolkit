import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateCostOfDelayPrompts(data: { items: PrioritizationItem[]; totalCost: number }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.slice(0, 20).map((it) => [it.title, `$${(Number(it.fields?.perWeekUsd) || 0).toLocaleString()}`, Number(it.fields?.weeksDelayed) || 0, `$${Math.round(it.score ?? 0).toLocaleString()}`]);
  const table = formatTable(["Title", "$/week", "Weeks", "Total"], rows);
  return [
    {
      id: "cod-narrative",
      title: "Cost-of-Delay Narrative",
      description: "Build a board-ready narrative around CoD totals.",
      prompt:
        buildPreamble("Cost-of-Delay Tracker", "It quantifies the per-week revenue/value loss of delays.") +
        `Total CoD this period: $${data.totalCost.toLocaleString()}\n\n## Items\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Draft a 3-sentence narrative for an exec readout: what's the cost, what's at stake, what to do.\n` +
        `2. Which item would you crash (add resources to) for the best ROI?\n` +
        `3. Are any per-week estimates over-precise (false confidence)?\n` +
        `4. What sensitivity range would you put around the total CoD?\n` +
        `5. Recommend a queue policy that minimises CoD across this set.`,
    },
  ];
}
