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
 * - VIP tools (`tool.access === "vip"`): extras for readers of the printed
 *   book. Menus and counts list them only when `vip` is true, which callers
 *   take from the display hint cookie (lib/vip/use-vip-hint). That only changes
 *   what a menu shows: each VIP page checks the real cookie on the server.
 *   "Show all tools" doesn't reveal them, so the home page keeps promising the
 *   same number of tools to everyone else.
 * - anything `pendingApproval`: built but not released, listed for nobody.
 *
 * Categories left empty by that filtering are dropped too.
 */

import { categories, tools, type ToolCategory, type ToolDefinition } from "@/lib/constants/tools";

/** Whether a tool sits on the "More tools" shelf. */
export function isShelved(tool: Pick<ToolDefinition, "shelf">): boolean {
  return tool.shelf === "more";
}

/** Whether a tool is for readers of the printed book. */
export function isVipOnly(tool: Pick<ToolDefinition, "access">): boolean {
  return tool.access === "vip";
}

/** Whether a menu should leave this tool out, whatever the visitor's favourites or recents say. */
export function isVipHidden(
  tool: Pick<ToolDefinition, "access" | "pendingApproval">,
  vip: boolean
): boolean {
  return Boolean(tool.pendingApproval) || (isVipOnly(tool) && !vip);
}

function isVisible(tool: ToolDefinition, showAll: boolean, vip: boolean): boolean {
  if (isVipHidden(tool, vip)) return false;
  return showAll || !isShelved(tool);
}

/** Every tool a visitor can open right now (`showAll` adds the shelf, `vip` the VIP tools). */
export function getVisibleTools(showAll = false, vip = false): ToolDefinition[] {
  return tools.filter((t) => isVisible(t, showAll, vip));
}

/**
 * The interactive tools a visitor sees before turning "Show all tools" on: the
 * number the home page promises, and the one the manifest and sign-in page say.
 */
export function defaultToolCount(): number {
  return getVisibleTools().filter((t) => t.kind !== "reading").length;
}

/** Visible tools in one category. */
export function getVisibleToolsByCategory(
  category: ToolCategory,
  showAll = false,
  vip = false
): ToolDefinition[] {
  return tools.filter((t) => t.category === category && isVisible(t, showAll, vip));
}

/** Categories that have at least one visible tool, in registry order. */
export function getVisibleCategories(showAll = false, vip = false): ToolCategory[] {
  return categories.filter((c) => getVisibleToolsByCategory(c, showAll, vip).length > 0);
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

/** What the /vip hub lists: every released VIP tool, in registry order. */
export function getVipTools(): ToolDefinition[] {
  return tools.filter((t) => isVipOnly(t) && !t.pendingApproval);
}
