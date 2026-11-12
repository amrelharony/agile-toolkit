"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Audience Wall, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function AudienceWallClient() {
  return (
    <ToolPageWrapper
      toolId="audience-wall"
      title="Audience Wall"
      description="Ask the room an open question and see the answers on a wall."
    >
      <EmptyState icon={Hammer}>
        Audience Wall is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
