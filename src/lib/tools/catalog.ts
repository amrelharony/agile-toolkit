/**
 * The tool list as visitors should see it.
 *
 * `lib/constants/tools.ts` is the full registry (agent/MCP read it too). This
 * layer hides what isn't usable yet — today that's the "Agile at Work" comic
 * until its PDF ships (`comicAsset().available`), which otherwise sat first in
 * the home grid, the sidebar and search as a "coming soon" page — and drops
 * categories left empty by that filtering.
 */

import { categories, tools, type ToolCategory, type ToolDefinition } from "@/lib/constants/tools";
import { comicAsset } from "@/lib/comic/agile-at-work";

function isVisible(tool: ToolDefinition, comicAvailable: boolean): boolean {
  if (tool.kind === "reading" && tool.id === "agile-at-work") return comicAvailable;
  return true;
}

/** Every tool a visitor can open right now. */
export function getVisibleTools(comicAvailable = comicAsset().available): ToolDefinition[] {
  return tools.filter((t) => isVisible(t, comicAvailable));
}

/** Visible tools in one category. */
export function getVisibleToolsByCategory(
  category: ToolCategory,
  comicAvailable = comicAsset().available
): ToolDefinition[] {
  return tools.filter((t) => t.category === category && isVisible(t, comicAvailable));
}

/** Categories that have at least one visible tool, in registry order. */
export function getVisibleCategories(comicAvailable = comicAsset().available): ToolCategory[] {
  return categories.filter((c) => getVisibleToolsByCategory(c, comicAvailable).length > 0);
}
