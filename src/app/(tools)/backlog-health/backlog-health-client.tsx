"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Backlog Health, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function BacklogHealthClient() {
  return (
    <ToolPageWrapper
      toolId="backlog-health"
      title="Backlog Health"
      description="Check the backlog is detailed, estimated, emergent and prioritized."
    >
      <EmptyState icon={Hammer}>
        Backlog Health is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
