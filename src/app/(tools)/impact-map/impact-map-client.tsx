"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Impact Map, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function ImpactMapClient() {
  return (
    <ToolPageWrapper
      toolId="impact-map"
      title="Impact Map"
      description="From a goal to who can move it, how, and what to build."
    >
      <EmptyState icon={Hammer}>
        Impact Map is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
