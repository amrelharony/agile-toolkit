"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Meeting Audit, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function MeetingAuditClient() {
  return (
    <ToolPageWrapper
      toolId="meeting-audit"
      title="Meeting Audit"
      description="What each recurring meeting costs, and whether it earns its place."
    >
      <EmptyState icon={Hammer}>
        Meeting Audit is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
