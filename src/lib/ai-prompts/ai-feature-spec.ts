import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateAIFeatureSpecPrompts(spec: Record<string, string>, workspace?: Workspace | null): PromptDefinition[] {
  if (!spec.featureName?.trim()) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const body = Object.entries(spec)
    .filter(([k, v]) => typeof v === "string" && v.trim() && k !== "set" && k !== "reset")
    .map(([k, v]) => `### ${k}\n${v}`)
    .join("\n\n");
  return [
    {
      id: "spec-review",
      title: "Spec Review",
      description: "Score the spec for completeness, testability, and risk-readiness.",
      prompt:
        buildPreamble("AI Feature Spec", "It defines an AI feature: model, evals, fallbacks, budgets, rollout.") +
        `## Spec\n\n${body}\n` + context +
        `\n## Questions\n\n` +
        `1. Is the eval criteria measurable and falsifiable? If not, rewrite it.\n` +
        `2. Is the fallback truly safe (does it degrade gracefully without misleading the user)?\n` +
        `3. Are the latency, cost, and hallucination budgets realistic given the model choice?\n` +
        `4. What edge cases will the rollout plan miss?\n` +
        `5. Score this spec 1-10 on completeness; list the three biggest gaps.`,
    },
  ];
}
