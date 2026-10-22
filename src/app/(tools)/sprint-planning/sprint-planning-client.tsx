"use client";

import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SprintPlanning, TOOL_ID } from "./planning";

export function SprintPlanningClient() {
  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Sprint Planning"
      description="Plan the sprint in one pass: check capacity and velocity, write the goal, pull stories from the backlog, size them and commit."
      category="Sprint Planning & Estimation"
    >
      <SprintPlanning />
    </ToolPageWrapper>
  );
}
