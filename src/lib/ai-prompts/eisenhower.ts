import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateEisenhowerPrompts(data: { grouped: Record<string, PrioritizationItem[]> }, workspace?: Workspace | null): PromptDefinition[] {
  const total = Object.values(data.grouped).reduce((s, l) => s + l.length, 0);
  if (total === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const sections = Object.entries(data.grouped).map(([k, v]) => `### ${k.toUpperCase()} (${v.length})\n${v.map((it) => `- ${it.title}`).join("\n") || "_empty_"}`).join("\n\n");
  return [
    {
      id: "eisenhower-coaching",
      title: "Personal Productivity Coaching",
      description: "Coach the user toward more 'Schedule' time and less 'Do/Delete'.",
      prompt:
        buildPreamble("Eisenhower Matrix", "It plots tasks on Urgent vs Important.") +
        sections + "\n" + context +
        `\n## Questions\n\n` +
        `1. Is the 'Do' quadrant overloaded — am I living in firefighting mode?\n` +
        `2. Which 'Schedule' items would have the biggest payoff if I made time this week?\n` +
        `3. Who could I realistically delegate the 'Delegate' items to?\n` +
        `4. Are 'Delete' items truly trivial, or am I avoiding hard work?\n` +
        `5. Recommend three habit changes to shift more time into Schedule next month.`,
    },
  ];
}
