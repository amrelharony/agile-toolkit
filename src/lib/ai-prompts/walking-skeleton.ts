import type { PromptDefinition } from "./types";
import { buildPreamble } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface Data { goal: string; steps: { layer: string; text: string; done: boolean }[]; }

export function generateWalkingSkeletonPrompts(data: Data, workspace?: Workspace | null): PromptDefinition[] {
  // Return early if EITHER the goal or steps are missing — a half-defined
  // skeleton produces low-signal advice.
  if (!data.goal.trim() || data.steps.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const lines = data.steps.map((s) => `- [${s.done ? "x" : " "}] (${s.layer}) ${s.text}`).join("\n");
  return [
    {
      id: "skeleton-review",
      title: "Skeleton Review",
      description: "Audit whether this is a true walking skeleton — minimal but end-to-end.",
      prompt:
        buildPreamble("Walking Skeleton", "It defines the smallest end-to-end implementation that proves the architecture.") +
        `## Goal\n${data.goal || "_undefined_"}\n\n## Steps\n${lines || "_none_"}\n` + context +
        `\n## Questions\n\n` +
        `1. Does this skeleton truly cover every architectural layer (UI → API → data → infra)?\n` +
        `2. Is anything in here that isn't strictly needed for the walking skeleton?\n` +
        `3. What's the riskiest unproven assumption this skeleton would validate?\n` +
        `4. Recommend a 1-week plan to ship the skeleton.\n` +
        `5. What metric would confirm the skeleton works as expected?`,
    },
  ];
}
