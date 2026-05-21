import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { RankedItem } from "../analytics/scoring-rubric";

export function generateWsjfPrompts(data: { items: RankedItem<Record<string, number | string>>[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.slice(0, 20).map((r) => [r.rank, r.title, r.fields.businessValue, r.fields.timeCriticality, r.fields.rrOe, r.fields.jobSize, r.score.toFixed(2)]);
  const table = formatTable(["#", "Title", "BV", "TC", "RR/OE", "Size", "WSJF"], rows);
  return [
    {
      id: "wsjf-sequencing",
      title: "WSJF Sequencing & PI Plan",
      description: "Translate WSJF rankings into a PI-level commitment.",
      prompt:
        buildPreamble("WSJF Calculator", "It sequences work by Cost-of-Delay ÷ Job Size.") +
        `## Ranked features\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. What features should make the next PI based on capacity (assume 50 SP/sprint × 5 sprints)?\n` +
        `2. Which 'Time Criticality' scores look unrealistic? Recheck with the team.\n` +
        `3. Could splitting any large item into 2 produce a better WSJF outcome?\n` +
        `4. Are 'Job Size' estimates calibrated against historical actuals?\n` +
        `5. Which items would you defer entirely?`,
    },
  ];
}
