"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Flow Insights, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function FlowInsightsClient() {
  return (
    <ToolPageWrapper
      toolId="flow-insights"
      title="Flow Insights"
      description="The mix of work you finish, the repeat work and how stable the team is."
    >
      <EmptyState icon={Hammer}>
        Flow Insights is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
