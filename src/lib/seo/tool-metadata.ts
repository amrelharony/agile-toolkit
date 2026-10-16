import type { Metadata } from "next";
import { getToolById } from "@/lib/constants/tools";

/**
 * Page metadata for a tool, from the tool registry: the tool's name as the
 * title (the root layout's template appends " | Agile Toolkit") and its
 * one-line description for search results and link previews.
 */
export function toolMetadata(toolId: string, overrides: Metadata = {}): Metadata {
  const tool = getToolById(toolId);
  if (!tool) throw new Error(`toolMetadata: unknown tool "${toolId}"`);
  return {
    title: tool.name,
    description: tool.description,
    ...overrides,
  };
}
