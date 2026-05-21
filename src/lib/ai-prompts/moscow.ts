import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateMoscowPrompts(data: { grouped: Record<string, PrioritizationItem[]> }, workspace?: Workspace | null): PromptDefinition[] {
  const total = Object.values(data.grouped).reduce((s, l) => s + l.length, 0);
  if (total === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const sections = wrapUserContent(
    Object.entries(data.grouped)
      .map(
        ([k, v]) =>
          `### ${sanitizePromptCell(k, 40).toUpperCase()} (${v.length})\n${
            v.slice(0, 40).map((it) => `- ${sanitizePromptCell(it.title, 120)}`).join("\n") || "_empty_"
          }`,
      )
      .join("\n\n"),
  );
  return [
    {
      id: "moscow-balance",
      title: "Scope Balance Check",
      description: "Audit the Must/Should/Could/Won't ratio for realism.",
      prompt:
        buildPreamble("MoSCoW Matrix", "It buckets scope into Must / Should / Could / Won't.") +
        `${sections}\n` + context +
        `\n## Questions\n\n` +
        `1. Is the Must list too long? It should be ≤ 60% of total effort.\n` +
        `2. Are 'Won't have (this time)' items rationalised — could any actually be Musts?\n` +
        `3. What item, if dropped from Must, would unblock the timeline most?\n` +
        `4. Recommend a stakeholder communication script for the Won't list.\n` +
        `5. Are there missing items in any bucket?`,
    },
  ];
}
