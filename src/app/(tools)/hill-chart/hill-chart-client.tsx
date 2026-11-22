"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Hill Chart, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function HillChartClient() {
  return (
    <ToolPageWrapper
      toolId="hill-chart"
      title="Hill Chart"
      description="Where each piece of work stands: still working it out, or getting it done."
    >
      <EmptyState icon={Hammer}>
        Hill Chart is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
