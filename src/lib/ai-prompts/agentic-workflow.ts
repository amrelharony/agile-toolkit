import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { AgentNode, AgentWorkflow, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data { workflow?: AgentWorkflow; nodes: AgentNode[]; }

export function generateAgenticWorkflowPrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  if (!data.workflow || data.nodes.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const lines = data.nodes.map((n, i) => `${i + 1}. [${n.kind}] ${n.label}${n.description ? ` — ${n.description}` : ""}`).join("\n");
  return [
    {
      id: "agent-flow-review",
      title: "Agent Flow Review",
      description: "Audit the workflow for missing fallbacks, human checkpoints, and tool selection.",
      prompt:
        buildPreamble("Agentic Workflow Designer", "It defines an agent's stepwise plan with kind annotations.") +
        `## Workflow: ${data.workflow.name}\n${data.workflow.description ?? ""}\n\n## Steps\n${lines}\n` + context +
        `\n## Questions\n\n` +
        `1. Are there steps lacking a fallback for failure? Add them.\n` +
        `2. Where are human-in-the-loop checkpoints needed for high-stakes branches?\n` +
        `3. Is the tool selection appropriate at each step? What's the cheapest equivalent?\n` +
        `4. What guardrails would you add (input validation, output sanity-check)?\n` +
        `5. Sketch a regression test that exercises this whole workflow end-to-end.`,
    },
  ];
}
