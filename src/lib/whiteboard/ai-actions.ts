/**
 * AI-driven canvas actions — sticky-from-prompt, translate, rewrite,
 * action-item extraction.
 *
 * The toolkit doesn't ship a hard dependency on a specific LLM
 * provider. Each action here returns a `PromptDefinition` (same shape
 * AiPromptGenerator already consumes) that captures all the context
 * the user's chosen model needs. The user invokes the prompt through
 * the existing AiPromptGenerator UI — copy → paste into their model
 * → paste the structured response back into the canvas.
 *
 * For models that auto-execute (Claude Code, Cursor), the same prompts
 * work because they're structured around "produce JSON shaped like X"
 * instructions.
 */

import type { PromptDefinition } from "@/lib/ai-prompts/types";
import { buildPreamble } from "@/lib/ai-prompts/prompt-utils";
import { buildWorkspaceContext } from "@/lib/ai-prompts/cross-tool-context";
import type { Workspace, WhiteboardObject } from "@/lib/stores/workspace-types";
import { objectText } from "./search";

/** Build the prompt that drives "Brainstorm N stickies about TOPIC".
 * Includes sprint/risk/OKR context so the AI's suggestions land in the
 * team's actual situation, not generic platitudes. */
export function generateStickiesPrompt(topic: string, count = 10, workspace?: Workspace | null): PromptDefinition {
  const ctx = buildWorkspaceContext(workspace ?? undefined);
  return {
    id: "canvas-generate-stickies",
    title: `Brainstorm ${count} stickies`,
    description: `Generate ${count} short sticky-note ideas about "${topic}" tuned to your team's current state.`,
    prompt: `${buildPreamble("canvas", `Brainstorm ${count} stickies about: ${topic}`)}${ctx}

## Task
Generate exactly ${count} sticky-note ideas about: **${topic}**

## Guidelines
- Each sticky is 1-2 short sentences. Use plain language.
- Tailor to the team's current state (see context above): velocity, impediments, risks, OKRs.
- Mix concrete actions with open questions — brainstorm boards need both.
- Avoid duplicates.

## Output format
Return a JSON array of strings, exactly ${count} items long, no commentary:

\`\`\`json
["sticky 1 text", "sticky 2 text", ...]
\`\`\`
`,
  };
}

/** Translate selected stickies to a target language. */
export function translateStickiesPrompt(objects: readonly WhiteboardObject[], targetLanguage: string): PromptDefinition {
  const items = objects
    .map((o, i) => ({ i, id: o.id, text: objectText(o) ?? "" }))
    .filter((x) => x.text.length > 0);
  return {
    id: "canvas-translate",
    title: `Translate to ${targetLanguage}`,
    description: `Translate ${items.length} object${items.length === 1 ? "" : "s"} to ${targetLanguage}.`,
    prompt: `${buildPreamble("canvas", `Translate ${items.length} board items to ${targetLanguage}`)}

## Task
Translate every item below to **${targetLanguage}**. Preserve length and tone.

## Items
${items.map((x) => `${x.i + 1}. [${x.id}] ${x.text}`).join("\n")}

## Output format
Return JSON keyed by object id, no commentary:

\`\`\`json
{ "${items[0]?.id ?? "id1"}": "translated text", ... }
\`\`\`
`,
  };
}

/** Rewrite tone — bulk-apply over selection. */
export function rewriteTonePrompt(
  objects: readonly WhiteboardObject[],
  tone: "formal" | "casual" | "concise" | "actionable",
): PromptDefinition {
  const items = objects
    .map((o, i) => ({ i, id: o.id, text: objectText(o) ?? "" }))
    .filter((x) => x.text.length > 0);
  return {
    id: "canvas-rewrite",
    title: `Rewrite (${tone})`,
    description: `Rewrite ${items.length} object${items.length === 1 ? "" : "s"} in a more ${tone} tone.`,
    prompt: `${buildPreamble("canvas", `Rewrite ${items.length} board items in a more ${tone} tone`)}

## Task
Rewrite each item below in a more **${tone}** tone while preserving its meaning.

## Items
${items.map((x) => `${x.i + 1}. [${x.id}] ${x.text}`).join("\n")}

## Output format
Return JSON keyed by object id, no commentary:

\`\`\`json
{ "${items[0]?.id ?? "id1"}": "rewritten text", ... }
\`\`\`
`,
  };
}

/** Action-item extraction — finds the imperatives across the board
 * and assigns owners drawn from teamMembers. */
export function extractActionItemsPrompt(
  objects: readonly WhiteboardObject[],
  workspace?: Workspace | null,
): PromptDefinition {
  const items = objects
    .map((o) => objectText(o))
    .filter((x): x is string => !!x && x.length > 0)
    .slice(0, 200);
  const members = (workspace?.teamMembers ?? []).map((m) => `${m.id}|${m.name}|${m.role ?? ""}`).join("\n");
  return {
    id: "canvas-action-items",
    title: "Extract action items",
    description: "Walk the board, surface imperatives, assign owners.",
    prompt: `${buildPreamble("canvas", "Extract action items from board content")}${buildWorkspaceContext(workspace ?? undefined)}

## Task
Walk the board content below and extract concrete action items. For each:
- Phrase as an imperative starting with a verb ("Schedule…", "Draft…", "Investigate…")
- Suggest an owner from the team members list (id field), if a natural fit exists
- Suggest a target tool to track it in: "backlog" (story), "risk-register" (risk), "decision-log" (decision), "okrs" (key result), or "none"

## Team members
${members || "(no team members declared)"}

## Board content
${items.join("\n")}

## Output format
Return JSON array, no commentary:

\`\`\`json
[
  { "title": "Action 1", "ownerId": "tm_abc", "ownerName": "Alex", "targetTool": "backlog" },
  ...
]
\`\`\`
`,
  };
}
