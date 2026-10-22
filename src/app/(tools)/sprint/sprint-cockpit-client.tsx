"use client";

import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SprintCockpit, TOOL_ID } from "./cockpit";

export function SprintCockpitClient() {
  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Sprint Cockpit"
      description="Your current sprint on one page: goal and days left, burndown, today's standup, open blockers, retro actions and the next ceremony."
      category="Metrics & Dashboards"
    >
      <SprintCockpit />
    </ToolPageWrapper>
  );
}
