import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { OODACycle, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateOodaPrompts(data: { items: OODACycle[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const open = data.items.filter((c) => !c.completedAt);
  const recent = data.items.slice(0, 5).map((c) =>
    `### ${c.topic}\n- Observe: ${c.observe ?? "—"}\n- Orient: ${c.orient ?? "—"}\n- Decide: ${c.decide ?? "—"}\n- Act: ${c.act ?? "—"}`
  ).join("\n\n");
  return [
    {
      id: "ooda-coaching",
      title: "OODA Loop Coaching",
      description: "Improve loop speed and quality based on completed cycles.",
      prompt:
        buildPreamble("OODA Loop Tracker", "It tracks Observe-Orient-Decide-Act cycles.") +
        `Open cycles: ${open.length}\n\n## Recent cycles\n\n${recent}\n` + context +
        `\n## Questions\n\n` +
        `1. Where is the loop slowest — Observe, Orient, Decide, or Act?\n` +
        `2. Are 'Orient' steps surfacing assumptions and biases, or just restating facts?\n` +
        `3. Which open cycles need to close before the situation moves past us?\n` +
        `4. Recommend a faster cadence (e.g. daily 10-min OODA) for the current operating tempo.\n` +
        `5. What signal would tell us the OODA approach is paying off?`,
    },
  ];
}
