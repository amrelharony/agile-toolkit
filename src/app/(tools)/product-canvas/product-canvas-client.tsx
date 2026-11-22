"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Product Canvas, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function ProductCanvasClient() {
  return (
    <ToolPageWrapper
      toolId="product-canvas"
      title="Product Canvas"
      description="A product idea on one page, in the format that fits it."
    >
      <EmptyState icon={Hammer}>
        Product Canvas is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
