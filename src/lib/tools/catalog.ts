/**
 * The tool list as visitors should see it.
 *
 * `lib/constants/tools.ts` is the full registry (agent/MCP read it too). This
 * layer hides what shouldn't be in the way:
 *
 * - the "Agile at Work" comic until its PDF ships (`comicAsset().available`),
 *   which otherwise sat first in the home grid, the sidebar and search as a
 *   "coming soon" page;
 * - the "More tools" shelf (`tool.shelf === "more"`): tools built for a
 *   neighbouring audience — AI/LLM product work, security, SRE and incident
 *   response, developer-experience surveys, strategy frameworks. The toolkit
 *   is for Scrum masters and agile teams, so these stay out of the home grid,
 *   the sidebar, the palette's browse list and default search until a visitor
 *   turns "Show all tools" on (`useToolPrefs().showAllTools`; the reactive
 *   hook is `use-visible-tools.ts`). They keep their routes, guides, actions
 *   and sitemap entries.
 *
 * Categories left empty by that filtering are dropped too.
 */

import { categories, tools, type ToolCategory, type ToolDefinition } from "@/lib/constants/tools";
import { comicAsset } from "@/lib/comic/agile-at-work";

/** Whether a tool sits on the "More tools" shelf. */
export function isShelved(tool: Pick<ToolDefinition, "shelf">): boolean {
  return tool.shelf === "more";
}

function isVisible(tool: ToolDefinition, comicAvailable: boolean, showAll: boolean): boolean {
  if (tool.kind === "reading" && tool.id === "agile-at-work") return comicAvailable;
  if (isShelved(tool) && !showAll) return false;
  return true;
}

/** Every tool a visitor can open right now (`showAll` adds the shelf). */
export function getVisibleTools(
  comicAvailable = comicAsset().available,
  showAll = false
): ToolDefinition[] {
  return tools.filter((t) => isVisible(t, comicAvailable, showAll));
}

/** Visible tools in one category. */
export function getVisibleToolsByCategory(
  category: ToolCategory,
  comicAvailable = comicAsset().available,
  showAll = false
): ToolDefinition[] {
  return tools.filter((t) => t.category === category && isVisible(t, comicAvailable, showAll));
}

/** Categories that have at least one visible tool, in registry order. */
export function getVisibleCategories(
  comicAvailable = comicAsset().available,
  showAll = false
): ToolCategory[] {
  return categories.filter((c) => getVisibleToolsByCategory(c, comicAvailable, showAll).length > 0);
}

/** The shelved tools, in registry order. */
export function getShelfTools(): ToolDefinition[] {
  return tools.filter(isShelved);
}

/** Shelved tools grouped by registry category, in category order. */
export function getShelfToolsByCategory(): { category: ToolCategory; tools: ToolDefinition[] }[] {
  const shelf = getShelfTools();
  return categories
    .map((category) => ({ category, tools: shelf.filter((t) => t.category === category) }))
    .filter((g) => g.tools.length > 0);
}
