import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { RankedItem } from "../analytics/scoring-rubric";

export function generateIcePrompts(data: { items: RankedItem<Record<string, number | string>>[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.slice(0, 20).map((r) => [r.rank, r.title, r.fields.impact, r.fields.confidence, r.fields.ease, r.score]);
  const table = formatTable(["#", "Title", "I", "C", "E", "Score"], rows);
  return [
    {
      id: "ice-experiment-pipeline",
      title: "Experiment Pipeline Review",
      description: "Build a 4-week experiment pipeline from the top ICE-scored ideas.",
      prompt:
        buildPreamble("ICE Score", "It scores experiments by Impact × Confidence × Ease.") +
        `## Ideas\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Pick the top 4 ideas — sketch a 4-week experiment pipeline (1 per week).\n` +
        `2. For low-confidence ideas, what's the cheapest signal that would lift confidence?\n` +
        `3. Are 'ease' scores calibrated, or systematically optimistic?\n` +
        `4. Recommend three ideas worth killing.\n` +
        `5. What experiment is missing from this list?`,
    },
  ];
}
