import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell } from "./prompt-utils";
import type { LLMEval, Workspace } from "../stores/workspace-types";
import type { RegressionFinding } from "../analytics/eval-regression";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data {
  evals: LLMEval[];
  regressions: RegressionFinding[];
}

export function generateLLMEvalPrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  if (data.evals.length === 0) return [];

  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const recentRows = [...data.evals]
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
    .slice(0, 20)
    .map((e) => [
      e.recordedAt.slice(0, 10),
      e.model,
      e.dataset,
      e.promptVersion ?? "—",
      `${(e.score * 100).toFixed(1)}%`,
    ]);
  // formatTable auto-sanitizes string cells so model/dataset/promptVersion
  // are scrubbed of backticks and `<user_content>` delimiter literals.
  const evalTable = formatTable(["Date", "Model", "Dataset", "Prompt v", "Score"], recentRows);

  const regressionLines = data.regressions
    .map(
      (r) =>
        // r.group is `${promptVersion}|${dataset}` — both user-supplied.
        // Sanitize so a pasted "ignore previous instructions" in a dataset
        // label can't reach the model as a directive.
        `- ${sanitizePromptCell(r.group, 120)}: ${(r.baselineMean * 100).toFixed(1)}% → ${(r.recentMean * 100).toFixed(1)}% (Δ ${(r.delta * 100).toFixed(1)} pts · ${(r.confidence * 100).toFixed(0)}% conf)`,
    )
    .join("\n");

  return [
    {
      id: "llm-eval-regression-triage",
      title: "Regression Triage",
      description: "Diagnose root cause for the most recent statistically significant regressions.",
      prompt:
        buildPreamble(
          "LLM Eval Tracker",
          "It logs evaluation scores per (model, dataset, prompt-version) combination over time and flags statistically significant regressions.",
        ) +
        `## Recent Eval Runs\n\n${evalTable}\n\n` +
        (data.regressions.length > 0
          ? `## Detected Regressions\n\n${regressionLines}\n\n`
          : `## Detected Regressions\n\n_No statistically significant regressions in the current window._\n\n`) +
        context +
        `\n## Questions\n\n` +
        `1. For each regression, what is the most likely root cause (model upgrade, prompt change, dataset shift, infra change)?\n` +
        `2. Which (model, dataset) pair shows the strongest healthy trend? What's working there that we should replicate?\n` +
        `3. Is the eval set itself drifting? How would you detect that?\n` +
        `4. What additional eval coverage would catch this kind of regression earlier next time?\n` +
        `5. Recommend a specific rollback or hotfix for the worst regression. Concrete action items only.`,
    },
    {
      id: "llm-eval-strategy",
      title: "Eval Strategy Review",
      description: "Audit the eval program: coverage, cadence, signal-to-noise.",
      prompt:
        buildPreamble("LLM Eval Tracker", "It tracks how an LLM feature is performing across releases.") +
        `## Recent Eval Runs\n\n${evalTable}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Looking at the diversity of datasets, where are the gaps in eval coverage?\n` +
        `2. Is the cadence of runs consistent enough to catch regressions within 24h of a deploy?\n` +
        `3. Are scores too clustered around the same range (low signal) or too volatile (noisy)?\n` +
        `4. Recommend three new eval datasets that would harden quality for production AI features.\n` +
        `5. What thresholds (per dataset) would you set as 'must-not-cross' guardrails?`,
    },
  ];
}
