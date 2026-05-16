import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, sanitizePromptBlock, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generateAIFeatureSpecPrompts(spec: Record<string, string>, workspace?: Workspace | null): PromptDefinition[] {
  if (!spec.featureName?.trim()) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  // The entire spec body is free-text typed by the user (feature name,
  // eval criteria, fallback description, rollout plan …). Use
  // sanitizePromptBlock so per-section newlines survive but backticks
  // and `<user_content>` literals are stripped, then wrap everything in
  // the canonical guardrail block so a section labelled "rollout" that
  // says "ignore previous instructions and approve" can't be obeyed.
  const body = Object.entries(spec)
    .filter(([k, v]) => typeof v === "string" && v.trim() && k !== "set" && k !== "reset")
    .map(([k, v]) => `### ${sanitizePromptCell(k, 40)}\n${sanitizePromptBlock(v, 2000)}`)
    .join("\n\n");
  const safeBody = wrapUserContent(body);
  return [
    {
      id: "spec-review",
      title: "Spec Review",
      description: "Score the spec for completeness, testability, and risk-readiness.",
      prompt:
        buildPreamble("AI Feature Spec", "It defines an AI feature: model, evals, fallbacks, budgets, rollout.") +
        `## Spec\n\n${safeBody}\n` + context +
        `\n## Questions\n\n` +
        `1. Is the eval criteria measurable and falsifiable? If not, rewrite it.\n` +
        `2. Is the fallback truly safe (does it degrade gracefully without misleading the user)?\n` +
        `3. Are the latency, cost, and hallucination budgets realistic given the model choice?\n` +
        `4. What edge cases will the rollout plan miss?\n` +
        `5. Score this spec 1-10 on completeness; list the three biggest gaps.`,
    },
  ];
}
