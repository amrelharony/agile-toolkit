/**
 * Site knowledge for the agent's system prompt: the current tool's "How this
 * works" guide and a few related tools it can point the user to.
 *
 * Pure string building (no fetches, no stores), safe in the browser and on the
 * server. The caller loads the guide (`getGuide`) and picks the tools
 * (`searchTools`); this file only turns them into short prompt text.
 */

import type { ToolDefinition } from "@/lib/constants/tools";
import type { ToolGuide } from "@/lib/tools/guides/types";
import { isVipHidden } from "@/lib/tools/catalog";

type ToolInfo = Pick<ToolDefinition, "id" | "name" | "path" | "description">;
type LinkableTool = ToolInfo & Pick<ToolDefinition, "access" | "pendingApproval">;

/** One line with collapsed whitespace. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Cut `text` to `maxChars`, at a line break when one is close, ending with "…". */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const room = Math.max(0, maxChars - 1);
  const cut = text.slice(0, room);
  const lastBreak = cut.lastIndexOf("\n");
  const end = lastBreak > room * 0.6 ? lastBreak : room;
  return `${cut.slice(0, end).trimEnd()}…`;
}

/**
 * The current tool and how its method works, as prompt text: what it is, the
 * usual timebox, when to use it, the steps and tips. Without a guide (the
 * Library, VIP tools) it is just the tool's one-line description. Capped at
 * `maxChars` so a long guide can't crowd out the conversation.
 */
export function formatGuideForPrompt(
  tool: ToolInfo,
  guide: ToolGuide | null | undefined,
  maxChars = 1800
): string {
  const lines: string[] = [`Current tool: ${tool.name} (${tool.path})`];
  lines.push(`What it is: ${oneLine(guide?.summary ?? tool.description)}`);
  // The timebox goes up front: it's one line, and a long guide is clipped
  // from the end.
  if (guide?.timebox) lines.push(`Typical timebox: ${oneLine(guide.timebox)}`);
  if (guide) {
    if (guide.whenToUse.length > 0) {
      lines.push("When to use it:", ...guide.whenToUse.map((w) => `- ${oneLine(w)}`));
    }
    if (guide.steps.length > 0) {
      lines.push("How to run it:", ...guide.steps.map((s, i) => `${i + 1}. ${oneLine(s)}`));
    }
    if (guide.tips && guide.tips.length > 0) {
      lines.push("Tips:", ...guide.tips.map((t) => `- ${oneLine(t)}`));
    }
  }
  return clip(lines.join("\n"), maxChars);
}

/**
 * Up to `max` tools as Markdown links the chat renders, one per line:
 * `[Name](/path): description`. Tools a visitor can't open (VIP-only, or not
 * released yet) are never suggested.
 */
export function formatRelatedTools(tools: readonly LinkableTool[], max = 4): string {
  return tools
    .filter((t) => !isVipHidden(t, false))
    .slice(0, max)
    .map((t) => `- [${t.name}](${t.path}): ${oneLine(t.description)}`)
    .join("\n");
}

/**
 * The grounding block `buildSystemPrompt` appends: the current tool's guide,
 * then related tools (the current tool itself left out). "" when there is
 * nothing to add.
 */
export function composeGrounding(opts: {
  tool?: ToolInfo | null;
  guide?: ToolGuide | null;
  related?: readonly LinkableTool[];
  maxRelated?: number;
}): string {
  const parts: string[] = [];
  if (opts.tool) {
    parts.push(
      `About the tool the user has open (use this to explain or coach):\n${formatGuideForPrompt(
        opts.tool,
        opts.guide
      )}`
    );
  }
  const related = formatRelatedTools(
    (opts.related ?? []).filter((t) => t.id !== opts.tool?.id),
    opts.maxRelated
  );
  if (related) {
    parts.push(
      `Toolkit pages that may help with this request (link them exactly as written when you suggest one):\n${related}`
    );
  }
  return parts.join("\n\n");
}
