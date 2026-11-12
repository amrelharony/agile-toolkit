"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Team Mixer, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function TeamMixerClient() {
  return (
    <ToolPageWrapper
      toolId="team-mixer"
      title="Team Mixer"
      description="Random groups and pairs, balanced by role or skill."
    >
      <EmptyState icon={Hammer}>
        Team Mixer is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
