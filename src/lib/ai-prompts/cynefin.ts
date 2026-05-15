import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { CynefinItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateCynefinPrompts(data: { grouped: Record<CynefinItem["domain"], CynefinItem[]> }, workspace?: Workspace | null): PromptDefinition[] {
  const total = Object.values(data.grouped).reduce((s, l) => s + l.length, 0);
  if (total === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const sections = Object.entries(data.grouped).map(([k, v]) => `### ${k} (${v.length})\n${v.map((it) => `- ${it.title}: ${it.rationale ?? "—"}`).join("\n") || "_empty_"}`).join("\n\n");
  return [
    {
      id: "cynefin-recipe",
      title: "Domain Recipe Audit",
      description: "Check that each item is in the right domain, and the recipe matches.",
      prompt:
        buildPreamble("Cynefin Decision Picker", "It classifies problems into Cynefin domains.") +
        sections + "\n" + context +
        `\n## Questions\n\n` +
        `1. Are any 'Clear' items actually Complicated in disguise (cargo-cult best practice)?\n` +
        `2. For Complex items, what safe-to-fail experiments would you propose?\n` +
        `3. Are Chaotic items being given enough rapid-stabilisation attention?\n` +
        `4. Recommend a re-classification for any item whose rationale looks weak.\n` +
        `5. What is the biggest organisational risk hiding in the Confused bucket?`,
    },
  ];
}
