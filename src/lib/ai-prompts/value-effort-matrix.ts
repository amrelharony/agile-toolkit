import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateValueEffortPrompts(data: { grouped: Record<string, PrioritizationItem[]> }, workspace?: Workspace | null): PromptDefinition[] {
  const total = Object.values(data.grouped).reduce((s, l) => s + l.length, 0);
  if (total === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const sections = Object.entries(data.grouped).map(([k, v]) => `### ${k} (${v.length})\n${v.map((it) => `- ${it.title} (v${it.fields?.value} e${it.fields?.effort})`).join("\n") || "_empty_"}`).join("\n\n");
  return [
    {
      id: "ve-quadrant-action",
      title: "Quadrant Action Plan",
      description: "Sequence work from the four quadrants.",
      prompt:
        buildPreamble("Value vs Effort Matrix", "It plots items into Quick Wins / Big Bets / Fill-Ins / Time Wasters.") +
        sections + "\n" + context +
        `\n## Questions\n\n` +
        `1. Which Quick Wins should ship in the next sprint?\n` +
        `2. Are 'Big Bets' actually big — or could any be split into Quick Wins?\n` +
        `3. Recommend the Time Wasters to drop and a script to communicate it.\n` +
        `4. Are 'Effort' estimates calibrated against historical actuals?\n` +
        `5. What's missing from this matrix?`,
    },
  ];
}
