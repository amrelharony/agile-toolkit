import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateKanoPrompts(data: { grouped: Record<string, PrioritizationItem[]> }, workspace?: Workspace | null): PromptDefinition[] {
  const total = Object.values(data.grouped).reduce((s, l) => s + l.length, 0);
  if (total === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const sections = wrapUserContent(
    Object.entries(data.grouped)
      .map(
        ([k, v]) =>
          `### ${sanitizePromptCell(k, 40)} (${v.length})\n${
            v.slice(0, 40).map((it) => `- ${sanitizePromptCell(it.title, 120)}`).join("\n") || "_empty_"
          }`,
      )
      .join("\n\n"),
  );
  return [
    {
      id: "kano-roadmap",
      title: "Kano-Driven Roadmap",
      description: "Convert Kano classifications into a sequenced roadmap.",
      prompt:
        buildPreamble("Kano Model", "It classifies features by satisfaction/dissatisfaction profile.") +
        `${sections}\n` + context +
        `\n## Questions\n\n` +
        `1. What sequence — Must-be → Performance → Attractive — best fits this set?\n` +
        `2. Which 'Indifferent' items can be dropped to free capacity?\n` +
        `3. Are any 'Reverse' items dangerous to ship at all?\n` +
        `4. Identify the highest-ROI Attractive feature for delight.\n` +
        `5. What survey would you run to validate these classifications with customers?`,
    },
  ];
}
