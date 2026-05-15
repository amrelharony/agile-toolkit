import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateHundredDollarPrompts(data: { items: PrioritizationItem[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.map((it) => [it.title, `$${Number(it.fields?.allocation) || 0}`]);
  const table = formatTable(["Item", "$"], rows);
  const total = data.items.reduce((s, x) => s + (Number(x.fields?.allocation) || 0), 0);
  return [
    {
      id: "100-test-readout",
      title: "Vote Readout",
      description: "Interpret allocation pattern and recommend a cut line.",
      prompt:
        buildPreamble("$100 Test", "It allocates a fixed $100 across competing items.") +
        `Total allocated: $${total} (target $100)\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Where would you draw the cut line based on votes?\n` +
        `2. Which items got an outsized fraction — strong consensus or one-voter dominance?\n` +
        `3. Are there candidates that received zero votes worth keeping anyway? Why?\n` +
        `4. What follow-up question would deepen the signal?\n` +
        `5. Recommend a script to share results with stakeholders.`,
    },
  ];
}
