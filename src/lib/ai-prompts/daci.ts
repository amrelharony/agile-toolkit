import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { DACIDecision, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateDaciPrompts(data: { items: DACIDecision[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.slice(0, 20).map((d) => [d.title, d.driver ?? "—", d.approver ?? "—", d.status]);
  const table = formatTable(["Title", "Driver", "Approver", "Status"], rows);
  return [
    {
      id: "daci-clarity",
      title: "Decision Clarity Audit",
      description: "Find decisions stuck open due to missing roles or unclear ownership.",
      prompt:
        buildPreamble("DACI Decision Doc", "It assigns Driver/Approver/Contributors/Informed roles to each decision.") +
        `${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Which open decisions are missing a Driver or Approver?\n` +
        `2. Are any Approvers overloaded (named in many decisions)?\n` +
        `3. Identify decisions that have been open too long — what unblocks them?\n` +
        `4. For decided items, which lacked enough Contributors / Informed before being made?\n` +
        `5. Recommend a default decision-making cadence to keep this list moving.`,
    },
  ];
}
