"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Relative Sizing, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function RelativeSizingClient() {
  return (
    <ToolPageWrapper
      toolId="relative-sizing"
      title="Relative Sizing"
      description="Size many stories at once by sorting them into buckets."
    >
      <EmptyState icon={Hammer}>
        Relative Sizing is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
