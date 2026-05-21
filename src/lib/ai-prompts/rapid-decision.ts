import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { RAPIDDecision, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateRapidPrompts(data: { items: RAPIDDecision[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.slice(0, 20).map((d) => [d.title, d.recommend ?? "—", d.decide ?? "—", d.status]);
  const table = formatTable(["Title", "Recommend", "Decide", "Status"], rows);
  return [
    {
      id: "rapid-friction",
      title: "Decision Friction Audit",
      description: "Find decisions stuck because Agree-list is too long or roles conflict.",
      prompt:
        buildPreamble("RAPID Decision Matrix", "It assigns Recommend / Agree / Perform / Input / Decide roles.") +
        `${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Which decisions have an over-large Agree list — friction risk?\n` +
        `2. Is the same person both Recommend and Decide on multiple items? Conflict.\n` +
        `3. Recommend a default escalation path when Agree blocks a decision.\n` +
        `4. For implemented items, did Perform actually receive enough Input?\n` +
        `5. Recommend a quarterly review cadence for this set.`,
    },
  ];
}
