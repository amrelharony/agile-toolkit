"use client";

import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { RetroActionsTracker, TOOL_ID } from "./tracker";

export function RetroActionsClient() {
  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Retro Actions"
      description="Every action the team agreed in a retro, with owner, due date and done — until it's really done — and how much of each retro's actions got done."
      category="Ceremonies"
    >
      <RetroActionsTracker />
    </ToolPageWrapper>
  );
}
