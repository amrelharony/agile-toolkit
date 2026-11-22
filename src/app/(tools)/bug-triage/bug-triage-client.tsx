"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Bug Triage, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function BugTriageClient() {
  return (
    <ToolPageWrapper
      toolId="bug-triage"
      title="Bug Triage"
      description="Sort new bugs by how bad and how soon, then decide each one."
    >
      <EmptyState icon={Hammer}>
        Bug Triage is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
