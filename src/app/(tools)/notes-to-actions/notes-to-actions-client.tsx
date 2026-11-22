"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Notes to Actions, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function NotesToActionsClient() {
  return (
    <ToolPageWrapper
      toolId="notes-to-actions"
      title="Notes to Actions"
      description="Turn meeting notes into actions, decisions, blockers and bugs."
    >
      <EmptyState icon={Hammer}>
        Notes to Actions is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
