"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Scrum Master Notebook, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function SmNotebookClient() {
  return (
    <ToolPageWrapper
      toolId="sm-notebook"
      title="Scrum Master Notebook"
      description="Your own notes on the team, with patterns over the weeks."
    >
      <EmptyState icon={Hammer}>
        Scrum Master Notebook is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
