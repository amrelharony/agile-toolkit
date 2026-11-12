/**
 * The notebook's links to other tools, always through the tool registry
 * (getToolById): a note's linked tool, and the tools Amr suggests for a
 * week. An id the registry doesn't have (a model's guess, an agent's typo,
 * a tool since removed) is dropped, never shown as a link, so every link
 * goes to a real page on this site.
 */

import { getToolById, tools, type ToolDefinition } from "@/lib/constants/tools";
import { isShelved, isVipOnly } from "@/lib/tools/catalog";
import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { NOTEBOOK_TOOL_ID } from "./model";

/** A tool as the notebook links it. */
export interface ToolLink {
  id: string;
  name: string;
  href: string;
}

/** A suggested tool, with why. */
export interface SuggestedTool extends ToolLink {
  why: string;
}

/**
 * The tool for `id` when the notebook may link to it: a real tool (not a
 * reading page, a VIP extra or one waiting for approval), and not the
 * notebook itself. Ids are matched as given, trimmed and lower case.
 */
export function linkableTool(id: string | null | undefined): ToolDefinition | undefined {
  if (typeof id !== "string") return undefined;
  const tool = getToolById(id.trim().toLowerCase());
  if (!tool || tool.id === NOTEBOOK_TOOL_ID) return undefined;
  if (isVipOnly(tool) || tool.pendingApproval || tool.kind === "reading") return undefined;
  return tool;
}

const linkOf = (t: ToolDefinition): ToolLink => ({ id: t.id, name: t.name, href: t.path });

/** A note's linked tool, or null when it has none the registry knows. */
export function linkedToolOf(e: Pick<NotebookEntry, "linkedTool">): ToolLink | null {
  const tool = linkableTool(e.linkedTool);
  return tool ? linkOf(tool) : null;
}

/** A linked tool's name, for search; undefined for an unknown id. */
export const toolNameOf = (id: string): string | undefined => linkableTool(id)?.name;

/**
 * Suggested tools as links: unknown ids dropped, each tool once, at most
 * `max`, in the order given. The reason is kept as plain text on one line.
 */
export function resolveSuggestedTools(
  items: readonly { id: string; why: string }[] | null | undefined,
  max = 5
): SuggestedTool[] {
  const out: SuggestedTool[] = [];
  for (const item of items ?? []) {
    if (out.length >= max) break;
    const tool = linkableTool(item?.id);
    if (!tool || out.some((o) => o.id === tool.id)) continue;
    const why = typeof item.why === "string" ? item.why.replace(/\s+/g, " ").trim() : "";
    out.push({ ...linkOf(tool), why });
  }
  return out;
}

/**
 * The tools a note can be linked to in the page's picker: the main tools
 * (not the "More tools" shelf), A to Z. A note linked to a shelved tool by
 * an agent keeps its link; the picker lists that one too (`keep`).
 */
export function pickableTools(keep?: string | null): ToolLink[] {
  const kept = linkableTool(keep);
  const list = tools.filter((t) => !isShelved(t) && linkableTool(t.id) !== undefined);
  if (kept && !list.some((t) => t.id === kept.id)) list.push(kept);
  return list.map(linkOf).sort((a, b) => a.name.localeCompare(b.name));
}
