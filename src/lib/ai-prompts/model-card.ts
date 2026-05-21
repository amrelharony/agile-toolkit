import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { ModelCard, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateModelCardPrompts(data: { items: ModelCard[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  // All five card fields are user-typed long-form descriptions —
  // sanitize each cell and wrap the joined block.
  const body = wrapUserContent(
    data.items
      .slice(0, 5)
      .map(
        (c) =>
          `### ${sanitizePromptCell(c.modelName, 80)}\n` +
          `- Use: ${sanitizePromptCell(c.intendedUse ?? "—", 300)}\n` +
          `- Eval: ${sanitizePromptCell(c.evaluation ?? "—", 300)}\n` +
          `- Limitations: ${sanitizePromptCell(c.limitations ?? "—", 300)}\n` +
          `- License: ${sanitizePromptCell(c.license ?? "—", 200)}`,
      )
      .join("\n\n"),
  );
  return [
    {
      id: "card-completeness",
      title: "Model Card Completeness",
      description: "Identify gaps and missing risk disclosures across model cards.",
      prompt:
        buildPreamble("Model Card Builder", "It documents each model's intended use, training data, evaluation, limitations, and license.") +
        `## Cards\n\n${body}\n` + context +
        `\n## Questions\n\n` +
        `1. Which cards are missing critical information (esp. limitations / biases)?\n` +
        `2. Are intended-use statements specific enough to prevent misuse?\n` +
        `3. Are licenses commercially compatible with our use case?\n` +
        `4. Recommend additional sections for higher-risk models.\n` +
        `5. Draft missing 'Limitations' text for any card that lacks it.`,
    },
  ];
}
