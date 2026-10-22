/**
 * The tool list as visitors should see it.
 *
 * `lib/constants/tools.ts` is the full registry (agent/MCP read it too). This
 * layer is what the home grid, the sidebar, the palette and search list: it
 * drops categories with no tools. (The private "Agile at Work" comic is in
 * no registry or list at all — see lib/comic/access.ts.)
 */

import { categories, tools, type ToolCategory, type ToolDefinition } from "@/lib/constants/tools";

/** Every tool a visitor can open right now. */
export function getVisibleTools(): ToolDefinition[] {
  return [...tools];
}

/** Visible tools in one category. */
export function getVisibleToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return tools.filter((t) => t.category === category);
}

/** Categories that have at least one visible tool, in registry order. */
export function getVisibleCategories(): ToolCategory[] {
  return categories.filter((c) => getVisibleToolsByCategory(c).length > 0);
}
