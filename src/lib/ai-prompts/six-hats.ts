import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { SixHatsThought, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateSixHatsPrompts(data: { grouped: Record<SixHatsThought["hat"], SixHatsThought[]> }, workspace?: Workspace | null): PromptDefinition[] {
  const total = Object.values(data.grouped).reduce((s, l) => s + l.length, 0);
  if (total === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const sections = wrapUserContent(
    Object.entries(data.grouped)
      .map(
        ([hat, list]) =>
          `### ${hat.toUpperCase()} (${list.length})\n${
            list
              .slice(0, 40)
              .map((t) => `- ${sanitizePromptCell(t.text, 200)}`)
              .join("\n") || "_empty_"
          }`,
      )
      .join("\n\n"),
  );
  return [
    {
      id: "six-hats-synthesis",
      title: "Synthesis & Decision",
      description: "Combine all six perspectives into an actionable recommendation.",
      prompt:
        buildPreamble("Six Thinking Hats", "It captures parallel thinking across six perspectives.") +
        `${sections}\n` + context +
        `\n## Questions\n\n` +
        `1. Which hats have the thinnest coverage? What's missing?\n` +
        `2. Are there sharp contradictions between Black (risks) and Yellow (benefits)? How to reconcile?\n` +
        `3. From Blue (process), what is the recommended next step?\n` +
        `4. Distill the discussion into a 3-sentence recommendation.\n` +
        `5. What new Green-hat creative angle hasn't been explored?`,
    },
  ];
}
