import type { ReactNode } from "react";
import { getGuide } from "@/lib/tools/guides";
import { ToolGuideProvider } from "./tool-guide-context";

/**
 * A tool's route layout wraps its page in this (scripts/generate-tool-art.mjs
 * writes those layouts). A server component: it looks the tool's guide up and
 * passes it on as data, so "How this works" renders its text on the server,
 * inside the collapsed panel. A tool without a guide (the Library's reading,
 * the VIP tools) passes none, and the panel stays away.
 */
export async function ToolGuide({ id, children }: { id: string; children: ReactNode }) {
  const guide = await getGuide(id);
  return <ToolGuideProvider guide={guide ?? null}>{children}</ToolGuideProvider>;
}
