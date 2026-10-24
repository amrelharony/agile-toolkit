"use client";

import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SprintCockpit, TOOL_ID } from "./cockpit";

export function SprintCockpitClient() {
  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Sprint Cockpit"
      description="Your current sprint on one page: where it stands, each ceremony, the burndown from the sprint board, open blockers, and closing it with carry-over."
      category="Metrics & Dashboards"
    >
      <SprintCockpit />
    </ToolPageWrapper>
  );
}
