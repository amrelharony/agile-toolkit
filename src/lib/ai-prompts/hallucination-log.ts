import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Hallucination, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data { items: Hallucination[]; }

export function generateHallucinationLogPrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const open = data.items.filter((x) => !x.resolvedAt);

  const rows = data.items
    .slice(0, 30)
    .map((x) => [
      x.loggedAt.slice(0, 10),
      x.severity,
      x.rootCause ?? "—",
      x.feature ?? "—",
      x.input.slice(0, 60),
      x.resolvedAt ? "resolved" : "open",
    ]);
  const table = formatTable(["Date", "Sev", "Cause", "Feature", "Input", "Status"], rows);

  return [
    {
      id: "halluc-pattern",
      title: "Pattern Analysis & Triage",
      description: "Find systemic causes across hallucinations and recommend prevention.",
      prompt:
        buildPreamble("Hallucination Log", "It tracks AI quality incidents with severity and root cause.") +
        `## Open Incidents: ${open.length}\n\n## Recent Log\n\n${table}\n` +
        context +
        `\n## Questions\n\n` +
        `1. What patterns emerge across root causes? Which one to attack first for max ROI?\n` +
        `2. Are certain features over-represented? Why?\n` +
        `3. For the top 3 critical incidents, suggest a concrete eval test that would catch a regression next time.\n` +
        `4. Recommend a prompt-engineering fix or RAG change for the most common cause category.\n` +
        `5. What proactive monitoring would have flagged these earlier?`,
    },
    {
      id: "halluc-prevention",
      title: "Prevention Playbook",
      description: "Generate a 30-day prevention plan based on the incident history.",
      prompt:
        buildPreamble("Hallucination Log", "Help build a 30-day prevention plan.") +
        `## Recent Log\n\n${table}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Draft a 30-day plan: week-by-week actions to reduce hallucination rate by 50%.\n` +
        `2. What input validation, output post-processing, or RAG-quality gates would have prevented these?\n` +
        `3. Recommend a small set of "canary inputs" to evaluate every release against.\n` +
        `4. Where should we add human-in-the-loop checkpoints?\n` +
        `5. What metric would best correlate with hallucination rate trends? Define an SLO.`,
    },
  ];
}
