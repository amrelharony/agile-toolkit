"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Improve, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function ImproveClient() {
  return (
    <ToolPageWrapper
      toolId="improve"
      title="Improve"
      description="Improve one thing at a time with an A3 or the Improvement Kata."
    >
      <EmptyState icon={Hammer}>
        Improve is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
