"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Facilitator Timers, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function FacilitatorTimersClient() {
  return (
    <ToolPageWrapper
      toolId="facilitator-timers"
      title="Facilitator Timers"
      description="Pomodoro, break screens, Crazy 8s and a meeting cost ticker."
    >
      <EmptyState icon={Hammer}>
        Facilitator Timers is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
