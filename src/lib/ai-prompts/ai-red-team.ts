import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { RedTeamFinding, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateAIRedTeamPrompts(data: { items: RedTeamFinding[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const rows = data.items.slice(0, 25).map((x) => [
    x.loggedAt.slice(0, 10), x.attackVector, x.severity,
    x.successful ? "yes" : "no", x.resolvedAt ? "resolved" : "open",
  ]);
  const table = formatTable(["Date", "Vector", "Sev", "Succeeded", "Status"], rows);
  return [
    {
      id: "red-team-coverage",
      title: "Red-Team Coverage Audit",
      description: "Identify under-tested attack surfaces and recommend next sessions.",
      prompt:
        buildPreamble("AI Red-Team Session Log", "It tracks adversarial testing of the AI system.") +
        `## Findings\n\n${table}\n` + context +
        `\n## Questions\n\n` +
        `1. Which attack categories are over-tested vs under-tested?\n` +
        `2. For successful attacks, what mitigation is most likely to generalise?\n` +
        `3. Recommend three new attack vectors to test in the next session.\n` +
        `4. Which open findings should block the next release?\n` +
        `5. Is the rate of successful attacks trending up or down? What does that imply?`,
    },
  ];
}
