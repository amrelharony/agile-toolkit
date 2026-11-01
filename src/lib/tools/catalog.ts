/**
 * The tool list as visitors should see it.
 *
 * `lib/constants/tools.ts` is the full registry (agent/MCP read it too). This
 * layer hides what shouldn't be in the way:
 *
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

/** Whether a tool sits on the "More tools" shelf. */
export function isShelved(tool: Pick<ToolDefinition, "shelf">): boolean {
  return tool.shelf === "more";
}

function isVisible(tool: ToolDefinition, showAll: boolean): boolean {
  return showAll || !isShelved(tool);
}

/** Every tool a visitor can open right now (`showAll` adds the shelf). */
export function getVisibleTools(showAll = false): ToolDefinition[] {
  return tools.filter((t) => isVisible(t, showAll));
}

/** Visible tools in one category. */
export function getVisibleToolsByCategory(
  category: ToolCategory,
  showAll = false
): ToolDefinition[] {
  return tools.filter((t) => t.category === category && isVisible(t, showAll));
}

/** Categories that have at least one visible tool, in registry order. */
export function getVisibleCategories(showAll = false): ToolCategory[] {
  return categories.filter((c) => getVisibleToolsByCategory(c, showAll).length > 0);
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
