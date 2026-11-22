"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Test Sessions, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function TestSessionsClient() {
  return (
    <ToolPageWrapper
      toolId="test-sessions"
      title="Test Sessions"
      description="Timed exploratory testing from a charter, with notes and a debrief."
    >
      <EmptyState icon={Hammer}>
        Test Sessions is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
