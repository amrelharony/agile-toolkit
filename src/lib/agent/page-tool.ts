/**
 * Which toolkit tool a page or a stored tool id refers to, from the tool
 * registry (`@/lib/constants/tools`), so the chat's grounding and its tool
 * selection agree on one canonical id.
 */

import { getToolById, getToolByPath, type ToolDefinition } from "@/lib/constants/tools";

/**
 * The id of the tool the page belongs to (not the raw URL slug, which isn't
 * always the id). A tool's sub-page (/retro/abc) and a trailing slash count as
 * the tool. null on pages that aren't a tool (/, /settings).
 */
export function toolIdForPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const exact = getToolByPath(pathname);
  if (exact) return exact.id;
  const m = pathname.match(/^\/([a-z0-9-]+)\//);
  return m ? (getToolByPath(`/${m[1]}`)?.id ?? null) : null;
}

/**
 * The tool a stored or passed-in tool id names. Accepts the id itself
 * ("retro"), its path ("/retro") or a bare slug, since older conversations
 * stored whatever the page gave them. undefined when it isn't a tool.
 */
export function resolvePageTool(toolId: string | null | undefined): ToolDefinition | undefined {
  if (!toolId) return undefined;
  return getToolById(toolId) ?? getToolByPath(toolId.startsWith("/") ? toolId : `/${toolId}`);
}
