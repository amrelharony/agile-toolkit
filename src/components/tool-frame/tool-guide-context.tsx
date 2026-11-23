"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ToolGuide } from "@/lib/tools/guides/types";

const ToolGuideContext = createContext<ToolGuide | null>(null);

/**
 * Hands a tool's "How this works" guide to its page. Each tool's route layout
 * (a server component, see components/tool-frame/tool-guide.tsx) looks the
 * guide up and passes it in as plain data, so the text is in the page's HTML
 * for a search engine or an assistant to read, and no tool page downloads
 * guide text as JavaScript.
 */
export function ToolGuideProvider({
  guide,
  children,
}: {
  guide: ToolGuide | null;
  children: ReactNode;
}) {
  return <ToolGuideContext.Provider value={guide}>{children}</ToolGuideContext.Provider>;
}

/** The current tool's guide, if its layout provided one. */
export function useToolGuide(): ToolGuide | null {
  return useContext(ToolGuideContext);
}
