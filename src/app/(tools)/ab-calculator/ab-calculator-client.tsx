"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * A/B Calculator, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function AbCalculatorClient() {
  return (
    <ToolPageWrapper
      toolId="ab-calculator"
      title="A/B Calculator"
      description="Plan an A/B test's size and length, then read its result."
    >
      <EmptyState icon={Hammer}>
        A/B Calculator is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
