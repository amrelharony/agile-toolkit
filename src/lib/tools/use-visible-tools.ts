"use client";

import { useMemo } from "react";
import type { ToolCategory, ToolDefinition } from "@/lib/constants/tools";
import {
  getShelfTools,
  getVisibleCategories,
  getVisibleTools,
  getVisibleToolsByCategory,
} from "./catalog";
import { useVipHint } from "@/lib/vip/use-vip-hint";
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
 * `useToolPrefs`) and, for VIP tools, the display hint cookie. Before those
 * hydrate the shelf and the VIP tools are hidden, which is also what the server
 * renders.
 */
export function useToolVisibility(): ToolVisibility {
  const { showAllTools, setShowAllTools } = useToolPrefs();
  const showAll = Boolean(showAllTools);
  const vip = useVipHint();
  return useMemo(() => {
    const tools = getVisibleTools(showAll, vip);
    const byId = new Map(tools.map((t) => [t.id, t]));
    return {
      showAll,
      setShowAll: setShowAllTools,
      tools,
      byId,
      categories: getVisibleCategories(showAll, vip),
      toolsIn: (category) => getVisibleToolsByCategory(category, showAll, vip),
      isVisible: (toolId) => byId.has(toolId),
      shelfCount: getShelfTools().length,
    };
  }, [showAll, vip, setShowAllTools]);
}
