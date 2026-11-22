"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Product Metrics, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function ProductMetricsClient() {
  return (
    <ToolPageWrapper
      toolId="product-metrics"
      title="Product Metrics"
      description="A North Star and its inputs, HEART goals and an AARRR funnel."
    >
      <EmptyState icon={Hammer}>
        Product Metrics is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
