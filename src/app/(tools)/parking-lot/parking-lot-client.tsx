"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Parking Lot, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function ParkingLotClient() {
  return (
    <ToolPageWrapper
      toolId="parking-lot"
      title="Parking Lot"
      description="Park off-topic points and send each one where it belongs."
    >
      <EmptyState icon={Hammer}>
        Parking Lot is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
