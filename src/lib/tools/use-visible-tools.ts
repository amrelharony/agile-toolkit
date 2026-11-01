"use client";

import { useMemo } from "react";
import type { ToolCategory, ToolDefinition } from "@/lib/constants/tools";
import {
  getShelfTools,
  getVisibleCategories,
  getVisibleTools,
  getVisibleToolsByCategory,
} from "./catalog";
import { useToolPrefs } from "./tool-prefs";

export interface ToolVisibility {
  /** "Show all tools" is on: the shelf is listed like everything else. */
  showAll: boolean;
  setShowAll: (on: boolean) => void;
  /** Every tool this visitor should see, in registry order. */
  tools: ToolDefinition[];
  byId: Map<string, ToolDefinition>;
  categories: ToolCategory[];
  toolsIn: (category: ToolCategory) => ToolDefinition[];
  isVisible: (toolId: string) => boolean;
  /** How many tools the shelf holds (for the "More tools (N)" links). */
  shelfCount: number;
}

/**
 * The catalog (lib/tools/catalog) made reactive: the same lists, following
 * the visitor's "Show all tools" preference (kept with favourites in
 * `useToolPrefs`). Before the preference hydrates the shelf is hidden, which
 * is also what the server renders.
 */
export function useToolVisibility(): ToolVisibility {
  const { showAllTools, setShowAllTools } = useToolPrefs();
  const showAll = Boolean(showAllTools);
  return useMemo(() => {
    const tools = getVisibleTools(showAll);
    const byId = new Map(tools.map((t) => [t.id, t]));
    return {
      showAll,
      setShowAll: setShowAllTools,
      tools,
      byId,
      categories: getVisibleCategories(showAll),
      toolsIn: (category) => getVisibleToolsByCategory(category, showAll),
      isVisible: (toolId) => byId.has(toolId),
      shelfCount: getShelfTools().length,
    };
  }, [showAll, setShowAllTools]);
}
