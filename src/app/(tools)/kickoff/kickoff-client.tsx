"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Kickoff, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function KickoffClient() {
  return (
    <ToolPageWrapper
      toolId="kickoff"
      title="Kickoff"
      description="Start a new team or piece of work on the same page."
    >
      <EmptyState icon={Hammer}>
        Kickoff is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
