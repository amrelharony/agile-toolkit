import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { RankedItem } from "../analytics/scoring-rubric";

interface Data { items: RankedItem<Record<string, number | string>>[]; outliers: string[]; }

export function generateRicePrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.slice(0, 20).map((r) => [r.rank, r.title, r.fields.reach, r.fields.impact, r.fields.confidence, r.fields.effort, r.score.toFixed(2)]);
  const table = formatTable(["#", "Title", "R", "I", "C%", "E", "Score"], rows);
  const outlierLines = data.outliers.length > 0 ? `## Outliers (recheck inputs)\n${data.items.filter((r) => data.outliers.includes(r.id)).map((r) => `- ${r.title}: score ${r.score.toFixed(2)}`).join("\n")}\n\n` : "";
  return [
    {
      id: "rice-review",
      title: "Backlog Review",
      description: "Pressure-test the top scores: are inputs realistic, or padded?",
      prompt:
        buildPreamble("RICE Scoring", "It scores initiatives by Reach × Impact × Confidence ÷ Effort.") +
        outlierLines + `## Ranked initiatives\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Which top-ranked items have suspiciously high inputs? Recheck them.\n` +
        `2. Are any items missing entirely (strategic bets, table-stakes)?\n` +
        `3. Recommend a quarterly cut line and the rationale.\n` +
        `4. For low-confidence items, what cheap experiment could lift confidence to 80%?\n` +
        `5. Are 'Effort' estimates calibrated against actuals from past sprints?`,
    },
  ];
}
