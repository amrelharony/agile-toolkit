import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data {
  checks: Record<string, boolean>;
  sections: { title: string; items: { id: string; text: string }[] }[];
}

export function generateAISafetyPrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const open = data.sections
    .flatMap((s) => s.items.filter((i) => !data.checks[i.id]).map((i) => `- [${s.title}] ${i.text}`))
    .join("\n");
  if (!open) return [];
  return [
    {
      id: "safety-gap",
      title: "Safety Gap Analysis",
      description: "Prioritize the most critical missing safety items before launch.",
      prompt:
        buildPreamble("AI Safety Review Checklist", "It tracks pre-launch safety items across privacy, security, content, ops, and NIST RMF.") +
        `## Open items\n\n${open}\n` + context +
        `\n## Questions\n\n` +
        `1. Which 3 unchecked items are blockers (must do before launch)?\n` +
        `2. Which can ship behind a feature flag with active monitoring?\n` +
        `3. Recommend a minimum viable safety bar for v1.0 vs a target bar for v1.1.\n` +
        `4. For each blocker, sketch the test you'd run to mark it done.\n` +
        `5. What additional items are missing from this checklist for our specific use case?`,
    },
  ];
}
