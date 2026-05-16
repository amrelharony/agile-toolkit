import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { AgentNode, AgentWorkflow, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data { workflow?: AgentWorkflow; nodes: AgentNode[]; }

export function generateAgenticWorkflowPrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  if (!data.workflow || data.nodes.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  // Node labels and descriptions are user-typed. Sanitize each, clamp
  // the node list at 50 entries (designer rarely needs more) and wrap
  // the whole block.
  const lines = wrapUserContent(
    data.nodes
      .slice(0, 50)
      .map(
        (n, i) =>
          `${i + 1}. [${n.kind}] ${sanitizePromptCell(n.label, 80)}${n.description ? ` — ${sanitizePromptCell(n.description, 200)}` : ""}`,
      )
      .join("\n"),
  );
  const safeWorkflowName = sanitizePromptCell(data.workflow.name, 80);
  const safeWorkflowDesc = data.workflow.description ? sanitizePromptCell(data.workflow.description, 400) : "";
  return [
    {
      id: "agent-flow-review",
      title: "Agent Flow Review",
      description: "Audit the workflow for missing fallbacks, human checkpoints, and tool selection.",
      prompt:
        buildPreamble("Agentic Workflow Designer", "It defines an agent's stepwise plan with kind annotations.") +
        `## Workflow: ${safeWorkflowName}\n${safeWorkflowDesc}\n\n## Steps\n${lines}\n` + context +
        `\n## Questions\n\n` +
        `1. Are there steps lacking a fallback for failure? Add them.\n` +
        `2. Where are human-in-the-loop checkpoints needed for high-stakes branches?\n` +
        `3. Is the tool selection appropriate at each step? What's the cheapest equivalent?\n` +
        `4. What guardrails would you add (input validation, output sanity-check)?\n` +
        `5. Sketch a regression test that exercises this whole workflow end-to-end.`,
    },
  ];
}
