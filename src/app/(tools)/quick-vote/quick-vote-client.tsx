"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Quick Vote, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function QuickVoteClient() {
  return (
    <ToolPageWrapper
      toolId="quick-vote"
      title="Quick Vote"
      description="Quick polls for any meeting, live in a room or on hold-up phone cards."
    >
      <EmptyState icon={Hammer}>
        Quick Vote is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
