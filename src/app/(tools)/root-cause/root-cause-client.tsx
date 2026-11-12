"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Root Cause, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function RootCauseClient() {
  return (
    <ToolPageWrapper
      toolId="root-cause"
      title="Root Cause"
      description="5 Whys and fishbone diagrams, from a problem to a countermeasure."
    >
      <EmptyState icon={Hammer}>
        Root Cause is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
