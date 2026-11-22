"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Example Mapping, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function ExampleMappingClient() {
  return (
    <ToolPageWrapper
      toolId="example-mapping"
      title="Example Mapping"
      description="A story's rules, examples and open questions, mapped in a timebox."
    >
      <EmptyState icon={Hammer}>
        Example Mapping is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
