"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Picker, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function PickerClient() {
  return (
    <ToolPageWrapper
      toolId="picker"
      title="Picker"
      description="Spin a wheel or pick names fairly, with dice, a coin and rotating roles."
    >
      <EmptyState icon={Hammer}>
        Picker is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
