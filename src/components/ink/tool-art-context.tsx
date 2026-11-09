"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { InkDrawing } from "@/lib/ink/types";

const ToolArtContext = createContext<InkDrawing | undefined>(undefined);

/**
 * Hands a tool's own drawing to ToolPageWrapper. Each tool's route layout (a
 * server component, see components/ink/tool-art.tsx) looks the drawing up and
 * passes it in as plain data, so it travels in the page's HTML and RSC payload
 * and no tool page downloads the other 118 drawings.
 */
export function ToolArtProvider({
  art,
  children,
}: {
  art: InkDrawing | undefined;
  children: ReactNode;
}) {
  return <ToolArtContext.Provider value={art}>{children}</ToolArtContext.Provider>;
}

/** The current tool's drawing, if its layout provided one. */
export function useToolArt(): InkDrawing | undefined {
  return useContext(ToolArtContext);
}
