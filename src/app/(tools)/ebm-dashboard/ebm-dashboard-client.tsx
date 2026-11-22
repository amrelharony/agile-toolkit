"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * EBM Dashboard, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function EbmDashboardClient() {
  return (
    <ToolPageWrapper
      toolId="ebm-dashboard"
      title="EBM Dashboard"
      description="Evidence-Based Management measures in four key value areas."
    >
      <EmptyState icon={Hammer}>
        EBM Dashboard is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
