"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Strategy Tree, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function StrategyTreeClient() {
  return (
    <ToolPageWrapper
      toolId="strategy-tree"
      title="Strategy Tree"
      description="Strategy as a tree you can test, from the vision to bets and owners."
    >
      <EmptyState icon={Hammer}>
        Strategy Tree is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
