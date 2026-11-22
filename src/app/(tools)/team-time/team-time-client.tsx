"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Team Time, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function TeamTimeClient() {
  return (
    <ToolPageWrapper
      toolId="team-time"
      title="Team Time"
      description="Shared hours, meeting polls, fair rotations and office days for a spread-out team."
    >
      <EmptyState icon={Hammer}>
        Team Time is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
