import type { ReactNode } from "react";
import { TOOL_ART } from "@/lib/ink/drawings/tools";
import { ToolArtProvider } from "./tool-art-context";

/**
 * A tool's route layout wraps its page in this (scripts/generate-tool-art.mjs
 * writes those layouts). A server component: it reads the full drawing map,
 * which never reaches the browser, and passes on only this tool's drawing.
 */
export function ToolArt({ id, children }: { id: string; children: ReactNode }) {
  return <ToolArtProvider art={TOOL_ART[id]}>{children}</ToolArtProvider>;
}
