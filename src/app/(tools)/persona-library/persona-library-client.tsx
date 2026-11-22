"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Persona Library, while it is being built (tools plan, phase 2). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function PersonaLibraryClient() {
  return (
    <ToolPageWrapper
      toolId="persona-library"
      title="Persona Library"
      description="The people you build for: their goals, frustrations and habits."
    >
      <EmptyState icon={Hammer}>
        Persona Library is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
