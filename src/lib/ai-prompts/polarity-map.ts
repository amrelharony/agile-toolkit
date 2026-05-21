import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Polarity, PolarityPole, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

export function generatePolarityPrompts(data: { polarities: Polarity[]; poles: PolarityPole[] }, workspace?: Workspace | null): PromptDefinition[] {
  if (data.polarities.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  // Title, purpose, fear, pole labels, upsides, and downsides are all
  // user-typed. Sanitize each cell and clamp the upside/downside lists
  // to 10 items so a noisy paste can't overflow the prompt budget.
  const sanList = (arr: string[]) =>
    arr.slice(0, 10).map((u) => sanitizePromptCell(u, 80)).join(", ");
  const lines = wrapUserContent(
    data.polarities
      .slice(0, 20)
      .map((pol) => {
        const l = data.poles.find((p) => p.polarityId === pol.id && p.side === "left");
        const r = data.poles.find((p) => p.polarityId === pol.id && p.side === "right");
        return (
          `### ${sanitizePromptCell(pol.title, 80)}\n` +
          `- Greater purpose: ${sanitizePromptCell(pol.greaterPurpose ?? "—", 200)}\n` +
          `- Deeper fear: ${sanitizePromptCell(pol.deeperFear ?? "—", 200)}\n` +
          `- Left "${sanitizePromptCell(l?.label ?? "—", 40)}" upsides: ${sanList(l?.upsides ?? [])} | downsides: ${sanList(l?.downsides ?? [])}\n` +
          `- Right "${sanitizePromptCell(r?.label ?? "—", 40)}" upsides: ${sanList(r?.upsides ?? [])} | downsides: ${sanList(r?.downsides ?? [])}`
        );
      })
      .join("\n\n"),
  );
  return [
    {
      id: "polarity-warning-signs",
      title: "Warning Signs & Action Steps",
      description: "For each polarity, identify warning signs of over-focus and corrective moves.",
      prompt:
        buildPreamble("Polarity Map", "It manages chronic tensions instead of solving them.") +
        lines + "\n" + context +
        `\n## Questions\n\n` +
        `1. For each polarity, what are 2–3 early warning signs we've over-rotated to one pole?\n` +
        `2. What action steps move us toward the upside of the under-used pole?\n` +
        `3. Are we currently in the upper-loop (best of both) or lower-loop (downsides) of each polarity?\n` +
        `4. Which polarity is the highest leverage for the org to manage right now?\n` +
        `5. Recommend a quarterly check-in question per polarity to track drift.`,
    },
  ];
}
