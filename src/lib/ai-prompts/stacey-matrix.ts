import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { StaceyItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateStaceyPrompts(data: { items: StaceyItem[]; grouped: Record<string, StaceyItem[]> }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  // Item titles are user-typed. Sanitize, clamp 30 per group, wrap.
  const sections = wrapUserContent(
    Object.entries(data.grouped)
      .map(
        ([k, v]) =>
          `### ${sanitizePromptCell(k, 40)} (${v.length})\n${
            v
              .slice(0, 30)
              .map(
                (it) =>
                  `- ${sanitizePromptCell(it.title, 120)} (a${it.agreement.toFixed(2)} c${it.certainty.toFixed(2)})`,
              )
              .join("\n") || "_empty_"
          }`,
      )
      .join("\n\n"),
  );
  return [
    {
      id: "stacey-strategy",
      title: "Strategy by Region",
      description: "Recommend a leadership posture for each region.",
      prompt:
        buildPreamble("Stacey Matrix", "It plots work by Agreement (what) and Certainty (how).") +
        sections + "\n" + context +
        `\n## Questions\n\n` +
        `1. Which simple items can be fully automated or templated?\n` +
        `2. For complicated items, who are the experts to engage?\n` +
        `3. For complex items, what light-touch probes would surface signal?\n` +
        `4. Are any chaotic items being managed with the wrong (e.g. planned) approach?\n` +
        `5. Recommend a quarterly cadence to revisit items moving between regions.`,
    },
  ];
}
