import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { PromptVersion, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generatePromptRegistryPrompts(data: { items: PromptVersion[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = [...data.items].slice(0, 20).map((p) => [p.name, p.version, p.status, p.changeNote ?? "—"]);
  const table = formatTable(["Name", "Version", "Status", "Change note"], rows);

  return [
    {
      id: "prompt-registry-audit",
      title: "Registry Hygiene Audit",
      description: "Find risky drift, missing version notes, and deprecated stragglers.",
      prompt:
        buildPreamble("Prompt Registry", "It versions and lifecycles LLM prompts.") +
        `## Versions\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Are there any prompts in production without a recorded eval score? Flag them.\n` +
        `2. Identify any orphaned drafts (no progress in a long time).\n` +
        `3. Are change-notes specific enough to roll back safely?\n` +
        `4. Recommend a versioning convention for this team based on the patterns you see.\n` +
        `5. Which prompts should be retired or consolidated?`,
    },
  ];
}
