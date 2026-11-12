"use client";

import { Hammer } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Card Decks, while it is being built (tools plan, phase 1). The stub keeps the
 * route, its guide and its drawing live; the tool's builder replaces it.
 */
export function CardDecksClient() {
  return (
    <ToolPageWrapper
      toolId="card-decks"
      title="Card Decks"
      description="Prompt, coaching and story-splitting cards, dealt one at a time."
    >
      <EmptyState icon={Hammer}>
        Card Decks is being built. How this works, above, says what it will do.
      </EmptyState>
    </ToolPageWrapper>
  );
}
