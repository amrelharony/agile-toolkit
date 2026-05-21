import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data {
  fromModel: string; toModel: string;
  evalDeltaPct: string; costDeltaPct: string;
  steps: { text: string; done: boolean }[];
}

export function generateModelMigrationPrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  if (!data.fromModel.trim() && !data.toModel.trim()) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  // From/to model names, eval/cost deltas, and step texts are all user-typed
  // and can hold pasted "ignore previous instructions" payloads. Sanitize each
  // cell and wrap the step block in <user_content> so the downstream model
  // treats them as data.
  const fromModel = sanitizePromptCell(data.fromModel, 80);
  const toModel = sanitizePromptCell(data.toModel, 80);
  const evalDelta = sanitizePromptCell(data.evalDeltaPct, 40);
  const costDelta = sanitizePromptCell(data.costDeltaPct, 40);
  const stepLines = wrapUserContent(
    data.steps.map((s) => `- [${s.done ? "x" : " "}] ${sanitizePromptCell(s.text, 200)}`).join("\n"),
  );
  return [
    {
      id: "migration-go-no-go",
      title: "Migration Go/No-Go",
      description: "Decide whether to ship the migration based on current evidence.",
      prompt:
        buildPreamble("Model Upgrade Migration Tracker", "It tracks an LLM migration with eval/cost deltas and a step checklist.") +
        `## Migration: ${fromModel} → ${toModel}\n` +
        `Eval delta: ${evalDelta}%  ·  Cost delta: ${costDelta}%\n\n## Steps\n${stepLines}\n` + context +
        `\n## Questions\n\n` +
        `1. Given the eval and cost delta, recommend Go / Hold / No-Go and justify in 2 sentences.\n` +
        `2. What incomplete steps are blockers vs nice-to-haves?\n` +
        `3. What rollback plan should be in place if a regression appears post-launch?\n` +
        `4. Are there hidden behavior changes typical for this kind of model upgrade we should regression-test?\n` +
        `5. What monitoring should we add for the first 30 days post-migration?`,
    },
  ];
}
