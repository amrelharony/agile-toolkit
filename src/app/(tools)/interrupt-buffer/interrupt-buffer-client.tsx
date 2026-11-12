"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Interrupt Buffer, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function InterruptBufferClient() {
  return (
    <ToolPageWrapper
      toolId="interrupt-buffer"
      title="Interrupt Buffer"
      description="Keep a buffer for unplanned work and log each interrupt."
    >
      <EmptyState icon={Hammer}>
        Interrupt Buffer is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
