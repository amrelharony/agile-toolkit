import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { VectorCollection, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateVectorInventoryPrompts(data: { items: VectorCollection[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.map((c) => [c.name, c.embeddingModel, c.dim, c.docCount.toLocaleString(), c.refreshCadence ?? "—", c.owner ?? "—"]);
  const table = formatTable(["Name", "Model", "Dim", "Docs", "Refresh", "Owner"], rows);
  return [
    {
      id: "vector-audit",
      title: "Vector Store Audit",
      description: "Find stale collections, embedding mismatches, and ownership gaps.",
      prompt:
        buildPreamble("Vector Store Inventory", "It catalogs embedding collections used for RAG.") +
        `## Collections\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Are any collections using outdated embedding models? Which should be re-embedded first?\n` +
        `2. Which collections lack a refresh cadence — risk of staleness?\n` +
        `3. Any unowned collections to assign?\n` +
        `4. Are collections sized appropriately (too small to be useful / too large to be cheap)?\n` +
        `5. Recommend a quarterly hygiene routine for this inventory.`,
    },
  ];
}
