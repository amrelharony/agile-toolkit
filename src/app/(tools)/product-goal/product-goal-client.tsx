"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Product Goal, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function ProductGoalClient() {
  return (
    <ToolPageWrapper
      toolId="product-goal"
      title="Product Goal"
      description="The Product Goal your sprints work towards, and how you'll know."
    >
      <EmptyState icon={Hammer}>
        Product Goal is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
